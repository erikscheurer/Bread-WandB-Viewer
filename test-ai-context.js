// Simple test for AI Context generation
const { compareConfigs } = require('./out/aiContext/ConfigDiffer');
const { summarizeMetric } = require('./out/aiContext/MetricSummarizer');
const { generateAIContext, calculateTokenEstimate } = require('./out/aiContext/ContextGenerator');
const { downsampleMetricPoints, MultiRunManager } = require('./out/MultiRunManager');
const { loadRunComparisonGroupSources } = require('./out/runComparisonGroups');
const { hasWandbMetricData } = require('./out/wandbParser');
const {
    normalizeMultiRunPanelRestorationState
} = require('./out/multiRunPanelState');
const protobuf = require('protobufjs');
const fs = require('fs');
const os = require('os');
const path = require('path');

console.log('Testing AI Context Generation...\n');

// Test 1: Config Differ
console.log('Test 1: Config Comparison');
const runConfigs = new Map();
runConfigs.set('run1', {
    learning_rate: 0.001,
    batch_size: 32,
    model: 'transformer',
    epochs: 50,
    run1_only: true
});
runConfigs.set('run2', {
    learning_rate: 0.0001,
    batch_size: 32,
    model: 'transformer',
    epochs: 75
});

const comparison = compareConfigs(runConfigs);
console.log('Common params:', Object.keys(comparison.common));
console.log('Differences:', Object.keys(comparison.differences));
if (
    !Object.prototype.hasOwnProperty.call(comparison.differences, 'run1_only') ||
    Object.prototype.hasOwnProperty.call(comparison.differences.run1_only, 'run2')
) {
    throw new Error('Parameters missing from a run must be reported as differences');
}
console.log('✓ Config comparison works\n');

// Test 2: Metric Summarizer
console.log('Test 2: Metric Summarization');
const mockMetric = [
    { step: 0, value: 2.34 },
    { step: 100, value: 1.56 },
    { step: 200, value: 0.89 },
    { step: 300, value: 0.45 },
    { step: 400, value: 0.23 },
    { step: 500, value: 0.12 }
];

const summary = summarizeMetric(mockMetric);
console.log('Initial:', summary.initial);
console.log('Final:', summary.final);
console.log('Min:', summary.min);
console.log('Trend:', summary.trend);
console.log('✓ Metric summarization works\n');

// Test 3: Token Estimation
console.log('Test 3: Token Estimation');
const sampleText = `# W&B Training Runs Context

## Run Summary
| Run ID | Name | Metrics |
|--------|------|---------|
| abc123 | test | loss: 2.3 -> 0.1 |

## Configuration
- learning_rate: 0.001
- batch_size: 32
`;

const tokens = calculateTokenEstimate(sampleText);
console.log('Sample text tokens:', tokens);
console.log('✓ Token estimation works\n');

// Test 4: Full Context Generation
console.log('Test 4: Full Context Generation');
const mockRuns = [
    {
        runId: 'run1_abc123',
        runName: 'baseline',
        filePath: '/test/run1.wandb',
        project: 'test-project',
        lastModified: Date.now(),
        isVisible: true
    }
];

const mockParsedData = new Map();
mockParsedData.set('run1_abc123', {
    runId: 'run1_abc123',
    runName: 'baseline',
    config: {
        learning_rate: 0.001,
        batch_size: 32,
        model: 'transformer'
    },
    metrics: {
        'loss/train': mockMetric,
        'accuracy': [
            { step: 0, value: 0.45 },
            { step: 100, value: 0.67 },
            { step: 200, value: 0.82 },
            { step: 300, value: 0.89 },
            { step: 400, value: 0.93 },
            { step: 500, value: 0.95 }
        ]
    },
    systemMetrics: {}
});

const context = generateAIContext(mockRuns, mockParsedData, '/test/folder');
console.log('Generated context length:', context.length, 'characters');
console.log('Context tokens:', calculateTokenEstimate(context));
console.log('\nFirst 500 characters:');
console.log(context.substring(0, 500));
console.log('...\n');
console.log('✓ Full context generation works\n');

async function testMultiRunHelpers() {
    console.log('Test 5: Multi-Run Performance Helpers');
    const points = Array.from({ length: 21_000 }, (_, step) => ({
        step,
        value: Math.sin(step / 100)
    }));
    const sampled = downsampleMetricPoints(points, 2_000);
    if (
        sampled.length !== 2_000 ||
        sampled[0] !== points[0] ||
        sampled[sampled.length - 1] !== points[points.length - 1]
    ) {
        throw new Error('Chart sampling must enforce the limit and preserve endpoints');
    }
    console.log('✓ Chart transfer sampling works\n');

    const manager = new MultiRunManager('/test', undefined, {}, true);
    for (let index = 0; index < 25; index++) {
        const runId = `run-${index}`;
        manager.addRun({ runId, runName: runId, isVisible: true });
        manager.getState().parsedData.set(runId, {
            runId,
            config: {},
            metrics: {},
            systemMetrics: {}
        });
        manager.cacheAccessOrder.push(runId);
    }
    manager.evictIfNeeded();
    if (manager.getState().parsedData.size !== 25) {
        throw new Error('Selected runs must not be evicted from the parsed cache');
    }
    manager.deselectAll();
    if (manager.getState().parsedData.size !== 20) {
        throw new Error('The deselected parsed cache must remain bounded');
    }
    const unselectedManager = new MultiRunManager('/test', undefined, {}, false);
    unselectedManager.addRun({ runId: 'remote-run', runName: 'remote-run', isVisible: true });
    if (unselectedManager.getSelectedCount() !== 0) {
        throw new Error('Disabled initial selection must leave discovered runs unselected');
    }
    console.log('✓ Selected-run retention and initial selection work\n');

    console.log('Test 6: Recursive Comparison Group Discovery');
    const tempFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'wandb-viewer-groups-'));
    const nestedFolder = path.join(tempFolder, 'experiment', 'wandb');
    fs.mkdirSync(nestedFolder, { recursive: true });
    fs.writeFileSync(
        path.join(nestedFolder, '.wandb-viewer-groups.json'),
        JSON.stringify({
            version: 1,
            groups: [{ id: 'nested-group', name: 'Nested', runIds: ['run-1'] }]
        })
    );
    try {
        const sources = await loadRunComparisonGroupSources([tempFolder]);
        if (
            sources.length !== 1 ||
            sources[0].folderPath !== nestedFolder ||
            sources[0].groups[0]?.id !== 'nested-group'
        ) {
            throw new Error('Nested comparison group file was not discovered');
        }
    } finally {
        fs.rmSync(tempFolder, { recursive: true, force: true });
    }
    console.log('✓ Recursive comparison group discovery works\n');

    console.log('Test 7: Lightweight Empty-Run Detection');
    const createHistoryFile = (filePath, steps) => {
        const root = new protobuf.Root();
        const namespace = new protobuf.Namespace('wandb_internal');
        const historyStep = new protobuf.Type('HistoryStep')
            .add(new protobuf.Field('num', 1, 'int64'));
        const historyItem = new protobuf.Type('HistoryItem')
            .add(new protobuf.Field('key', 1, 'string'))
            .add(new protobuf.Field('value_json', 16, 'string'));
        const historyRecord = new protobuf.Type('HistoryRecord')
            .add(new protobuf.Field('item', 1, 'HistoryItem', 'repeated'))
            .add(new protobuf.Field('step', 2, 'HistoryStep'));
        const record = new protobuf.Type('Record')
            .add(new protobuf.Field('history', 2, 'HistoryRecord'));
        namespace.add(historyStep).add(historyItem).add(historyRecord).add(record);
        root.add(namespace);

        const recordType = root.lookupType('wandb_internal.Record');
        const header = Buffer.alloc(7);
        header.write(':W&B', 0, 'ascii');
        const physicalRecords = steps.map(step => {
            const payload = Buffer.from(recordType.encode({
                history: {
                    step: { num: step },
                    item: [{ key: 'loss', value_json: JSON.stringify(1 / (step + 1)) }]
                }
            }).finish());
            const physical = Buffer.alloc(7 + payload.length);
            physical.writeUInt32LE(1, 0);
            physical.writeUInt16LE(payload.length, 4);
            physical.writeUInt8(1, 6);
            payload.copy(physical, 7);
            return physical;
        });
        fs.writeFileSync(filePath, Buffer.concat([header, ...physicalRecords]));
    };

    const emptyRunPath = path.join(tempFolder, 'empty.wandb');
    const populatedRunPath = path.join(tempFolder, 'populated.wandb');
    fs.mkdirSync(tempFolder, { recursive: true });
    createHistoryFile(emptyRunPath, [0]);
    createHistoryFile(populatedRunPath, [0, 1]);
    try {
        if (await hasWandbMetricData(emptyRunPath)) {
            throw new Error('A one-point run must remain classified as empty');
        }
        if (!await hasWandbMetricData(populatedRunPath)) {
            throw new Error('A two-point metric must be classified as populated');
        }
    } finally {
        fs.rmSync(tempFolder, { recursive: true, force: true });
    }
    console.log('✓ Lightweight empty-run detection works\n');

    console.log('Test 8: Multi-Run Panel Restoration State');
    const restored = normalizeMultiRunPanelRestorationState({
        folderPaths: ['/tmp/runs', '/tmp/runs'],
        selectedRunIds: ['run-1', 'run-1', 'run-2']
    });
    if (
        !restored ||
        restored.folderPaths.length !== 1 ||
        restored.selectedRunIds.join(',') !== 'run-1,run-2' ||
        normalizeMultiRunPanelRestorationState({ folderPaths: ['relative'] })
    ) {
        throw new Error('Panel restoration state was not normalized safely');
    }
    console.log('✓ Panel restoration state validation works\n');
}

testMultiRunHelpers().then(() => {
    console.log('All tests passed! 🎉');
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
