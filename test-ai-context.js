// Simple test for AI Context generation
const { compareConfigs } = require('./out/aiContext/ConfigDiffer');
const { summarizeMetric } = require('./out/aiContext/MetricSummarizer');
const { generateAIContext, calculateTokenEstimate } = require('./out/aiContext/ContextGenerator');

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

console.log('All tests passed! 🎉');
