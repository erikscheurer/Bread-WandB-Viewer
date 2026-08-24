import * as fs from 'fs';
import * as path from 'path';
import * as protobuf from 'protobufjs';

export interface MetricPoint {
    step: number;
    value: number;
    timestamp?: number;
}

export interface WandbMetrics {
    [metricName: string]: MetricPoint[];
}

export interface WandbConfig {
    [key: string]: any;
}

export interface WandbRunData {
    runId: string;
    project?: string;
    runName?: string;
    config: WandbConfig;
    metrics: WandbMetrics;
    systemMetrics: WandbMetrics;
    metadata?: any;
}

// LevelDB log format constants
const FILE_HEADER_SIZE = 7;
const RECORD_HEADER_SIZE = 7;
const BLOCK_SIZE = 32768; // 32KB
const MAX_INSPECTION_RECORD_BYTES = 8 * 1024 * 1024;

// Record types
const RECORD_TYPE_FULL = 1;
const RECORD_TYPE_FIRST = 2;
const RECORD_TYPE_MIDDLE = 3;
const RECORD_TYPE_LAST = 4;

// Cache the loaded protobuf root
let protoRoot: protobuf.Root | null = null;
let RecordType: protobuf.Type | null = null;

/**
 * Load the protobuf schema
 */
async function loadProtoSchema(): Promise<void> {
    if (protoRoot) return;

    const protoPath = path.join(__dirname, '..', 'src', 'wandb.proto');

    // Try multiple paths for the proto file
    const possiblePaths = [
        protoPath,
        path.join(__dirname, 'wandb.proto'),
        path.join(__dirname, '..', 'wandb.proto'),
    ];

    for (const tryPath of possiblePaths) {
        if (fs.existsSync(tryPath)) {
            protoRoot = await protobuf.load(tryPath);
            RecordType = protoRoot.lookupType('wandb_internal.Record');
            return;
        }
    }

    throw new Error('Could not find wandb.proto file');
}

/**
 * Load protobuf schema synchronously by creating the types manually
 * This avoids async issues and doesn't require the .proto file at runtime
 */
function loadProtoSchemaSync(): void {
    if (protoRoot) return;

    protoRoot = new protobuf.Root();

    // Define the core message types programmatically
    // This matches the wandb_internal.proto schema

    const RecordInfo = new protobuf.Type('RecordInfo')
        .add(new protobuf.Field('stream_id', 1, 'string'))
        .add(new protobuf.Field('tracelog_id', 100, 'string'));

    const HistoryStep = new protobuf.Type('HistoryStep')
        .add(new protobuf.Field('num', 1, 'int64'));

    const HistoryItem = new protobuf.Type('HistoryItem')
        .add(new protobuf.Field('key', 1, 'string'))
        .add(new protobuf.Field('nested_key', 2, 'string', 'repeated'))
        .add(new protobuf.Field('value_json', 16, 'string'));

    const HistoryRecord = new protobuf.Type('HistoryRecord')
        .add(new protobuf.Field('item', 1, 'HistoryItem', 'repeated'))
        .add(new protobuf.Field('step', 2, 'HistoryStep'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const ConfigItem = new protobuf.Type('ConfigItem')
        .add(new protobuf.Field('key', 1, 'string'))
        .add(new protobuf.Field('nested_key', 2, 'string', 'repeated'))
        .add(new protobuf.Field('value_json', 16, 'string'));

    const ConfigRecord = new protobuf.Type('ConfigRecord')
        .add(new protobuf.Field('update', 1, 'ConfigItem', 'repeated'))
        .add(new protobuf.Field('remove', 2, 'ConfigItem', 'repeated'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const SummaryItem = new protobuf.Type('SummaryItem')
        .add(new protobuf.Field('key', 1, 'string'))
        .add(new protobuf.Field('nested_key', 2, 'string', 'repeated'))
        .add(new protobuf.Field('value_json', 16, 'string'));

    const SummaryRecord = new protobuf.Type('SummaryRecord')
        .add(new protobuf.Field('update', 1, 'SummaryItem', 'repeated'))
        .add(new protobuf.Field('remove', 2, 'SummaryItem', 'repeated'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const StatsItem = new protobuf.Type('StatsItem')
        .add(new protobuf.Field('key', 1, 'string'))
        .add(new protobuf.Field('value_json', 16, 'string'));

    const Timestamp = new protobuf.Type('Timestamp')
        .add(new protobuf.Field('seconds', 1, 'int64'))
        .add(new protobuf.Field('nanos', 2, 'int32'));

    const StatsRecord = new protobuf.Type('StatsRecord')
        .add(new protobuf.Field('stats_type', 1, 'int32'))
        .add(new protobuf.Field('timestamp', 2, 'Timestamp'))
        .add(new protobuf.Field('item', 3, 'StatsItem', 'repeated'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const GitRepoRecord = new protobuf.Type('GitRepoRecord')
        .add(new protobuf.Field('remote_url', 1, 'string'))
        .add(new protobuf.Field('commit', 2, 'string'));

    const SettingsItem = new protobuf.Type('SettingsItem')
        .add(new protobuf.Field('key', 1, 'string'))
        .add(new protobuf.Field('value_json', 16, 'string'));

    const SettingsRecord = new protobuf.Type('SettingsRecord')
        .add(new protobuf.Field('item', 1, 'SettingsItem', 'repeated'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const TelemetryRecord = new protobuf.Type('TelemetryRecord')
        .add(new protobuf.Field('import_init_module', 1, 'string'))
        .add(new protobuf.Field('python_version', 8, 'string'))
        .add(new protobuf.Field('cli_version', 9, 'string'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const BranchPoint = new protobuf.Type('BranchPoint')
        .add(new protobuf.Field('run', 1, 'string'))
        .add(new protobuf.Field('value', 2, 'double'))
        .add(new protobuf.Field('metric', 3, 'string'));

    const RunRecord = new protobuf.Type('RunRecord')
        .add(new protobuf.Field('run_id', 1, 'string'))
        .add(new protobuf.Field('entity', 2, 'string'))
        .add(new protobuf.Field('project', 3, 'string'))
        .add(new protobuf.Field('config', 4, 'ConfigRecord'))
        .add(new protobuf.Field('summary', 5, 'SummaryRecord'))
        .add(new protobuf.Field('run_group', 6, 'string'))
        .add(new protobuf.Field('job_type', 7, 'string'))
        .add(new protobuf.Field('display_name', 8, 'string'))
        .add(new protobuf.Field('notes', 9, 'string'))
        .add(new protobuf.Field('tags', 10, 'string', 'repeated'))
        .add(new protobuf.Field('settings', 11, 'SettingsRecord'))
        .add(new protobuf.Field('sweep_id', 12, 'string'))
        .add(new protobuf.Field('host', 13, 'string'))
        .add(new protobuf.Field('starting_step', 14, 'int64'))
        .add(new protobuf.Field('storage_id', 16, 'string'))
        .add(new protobuf.Field('start_time', 17, 'Timestamp'))
        .add(new protobuf.Field('resumed', 18, 'bool'))
        .add(new protobuf.Field('telemetry', 19, 'TelemetryRecord'))
        .add(new protobuf.Field('runtime', 20, 'int32'))
        .add(new protobuf.Field('git', 21, 'GitRepoRecord'))
        .add(new protobuf.Field('forked', 22, 'bool'))
        .add(new protobuf.Field('branch_point', 23, 'BranchPoint'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const OutputRecord = new protobuf.Type('OutputRecord')
        .add(new protobuf.Field('output_type', 1, 'int32'))
        .add(new protobuf.Field('timestamp', 2, 'Timestamp'))
        .add(new protobuf.Field('line', 3, 'string'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const OutputRawRecord = new protobuf.Type('OutputRawRecord')
        .add(new protobuf.Field('output_type', 1, 'int32'))
        .add(new protobuf.Field('timestamp', 2, 'Timestamp'))
        .add(new protobuf.Field('line', 3, 'string'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const FilesItem = new protobuf.Type('FilesItem')
        .add(new protobuf.Field('path', 1, 'string'))
        .add(new protobuf.Field('policy', 2, 'int32'))
        .add(new protobuf.Field('type', 3, 'int32'));

    const FilesRecord = new protobuf.Type('FilesRecord')
        .add(new protobuf.Field('files', 1, 'FilesItem', 'repeated'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const ArtifactRecord = new protobuf.Type('ArtifactRecord')
        .add(new protobuf.Field('run_id', 1, 'string'))
        .add(new protobuf.Field('project', 2, 'string'))
        .add(new protobuf.Field('entity', 3, 'string'))
        .add(new protobuf.Field('type', 4, 'string'))
        .add(new protobuf.Field('name', 5, 'string'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const TBRecord = new protobuf.Type('TBRecord')
        .add(new protobuf.Field('log_dir', 1, 'string'))
        .add(new protobuf.Field('save', 2, 'bool'))
        .add(new protobuf.Field('root_dir', 3, 'string'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const AlertRecord = new protobuf.Type('AlertRecord')
        .add(new protobuf.Field('title', 1, 'string'))
        .add(new protobuf.Field('text', 2, 'string'))
        .add(new protobuf.Field('level', 3, 'string'))
        .add(new protobuf.Field('wait_duration', 4, 'int64'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const MetricOptions = new protobuf.Type('MetricOptions')
        .add(new protobuf.Field('step_sync', 1, 'bool'))
        .add(new protobuf.Field('hidden', 2, 'bool'))
        .add(new protobuf.Field('defined', 3, 'bool'));

    const MetricSummary = new protobuf.Type('MetricSummary')
        .add(new protobuf.Field('min', 1, 'bool'))
        .add(new protobuf.Field('max', 2, 'bool'))
        .add(new protobuf.Field('mean', 3, 'bool'))
        .add(new protobuf.Field('best', 4, 'bool'))
        .add(new protobuf.Field('last', 5, 'bool'));

    const MetricControl = new protobuf.Type('MetricControl')
        .add(new protobuf.Field('overwrite', 1, 'bool'));

    const MetricRecord = new protobuf.Type('MetricRecord')
        .add(new protobuf.Field('name', 1, 'string'))
        .add(new protobuf.Field('glob_name', 2, 'string'))
        .add(new protobuf.Field('step_metric', 4, 'string'))
        .add(new protobuf.Field('step_metric_index', 5, 'int32'))
        .add(new protobuf.Field('options', 6, 'MetricOptions'))
        .add(new protobuf.Field('summary', 7, 'MetricSummary'))
        .add(new protobuf.Field('goal', 8, 'int32'))
        .add(new protobuf.Field('control', 9, 'MetricControl'))
        .add(new protobuf.Field('expanded_from_glob', 10, 'bool'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const DiskInfo = new protobuf.Type('DiskInfo')
        .add(new protobuf.Field('total', 1, 'uint64'))
        .add(new protobuf.Field('used', 2, 'uint64'));

    const MemoryInfo = new protobuf.Type('MemoryInfo')
        .add(new protobuf.Field('total', 1, 'uint64'));

    const CpuInfo = new protobuf.Type('CpuInfo')
        .add(new protobuf.Field('count', 1, 'uint32'))
        .add(new protobuf.Field('count_logical', 2, 'uint32'));

    const AppleInfo = new protobuf.Type('AppleInfo')
        .add(new protobuf.Field('name', 1, 'string'));

    const GpuNvidiaInfo = new protobuf.Type('GpuNvidiaInfo')
        .add(new protobuf.Field('name', 1, 'string'))
        .add(new protobuf.Field('memory_total', 2, 'uint64'))
        .add(new protobuf.Field('cuda_cores', 3, 'uint32'))
        .add(new protobuf.Field('architecture', 4, 'string'))
        .add(new protobuf.Field('uuid', 5, 'string'));

    const GpuAmdInfo = new protobuf.Type('GpuAmdInfo')
        .add(new protobuf.Field('id', 1, 'string'))
        .add(new protobuf.Field('unique_id', 2, 'string'))
        .add(new protobuf.Field('name', 8, 'string'))
        .add(new protobuf.Field('memory_total', 12, 'uint64'));

    const EnvironmentRecord = new protobuf.Type('EnvironmentRecord')
        .add(new protobuf.Field('os', 1, 'string'))
        .add(new protobuf.Field('python', 2, 'string'))
        .add(new protobuf.Field('started_at', 3, 'Timestamp'))
        .add(new protobuf.Field('docker', 4, 'string'))
        .add(new protobuf.Field('args', 5, 'string', 'repeated'))
        .add(new protobuf.Field('program', 6, 'string'))
        .add(new protobuf.Field('code_path', 7, 'string'))
        .add(new protobuf.Field('code_path_local', 8, 'string'))
        .add(new protobuf.Field('git', 9, 'GitRepoRecord'))
        .add(new protobuf.Field('email', 10, 'string'))
        .add(new protobuf.Field('root', 11, 'string'))
        .add(new protobuf.Field('host', 12, 'string'))
        .add(new protobuf.Field('username', 13, 'string'))
        .add(new protobuf.Field('executable', 14, 'string'))
        .add(new protobuf.Field('colab', 15, 'string'))
        .add(new protobuf.Field('cpu_count', 16, 'uint32'))
        .add(new protobuf.Field('cpu_count_logical', 17, 'uint32'))
        .add(new protobuf.Field('gpu_type', 18, 'string'))
        .add(new protobuf.Field('gpu_count', 19, 'uint32'))
        .add(new protobuf.Field('memory', 21, 'MemoryInfo'))
        .add(new protobuf.Field('cpu', 22, 'CpuInfo'))
        .add(new protobuf.Field('apple', 23, 'AppleInfo'))
        .add(new protobuf.Field('gpu_nvidia', 24, 'GpuNvidiaInfo', 'repeated'))
        .add(new protobuf.Field('cuda_version', 25, 'string'))
        .add(new protobuf.Field('gpu_amd', 26, 'GpuAmdInfo', 'repeated'))
        .add(new protobuf.Field('writer_id', 199, 'string'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const UseArtifactRecord = new protobuf.Type('UseArtifactRecord')
        .add(new protobuf.Field('id', 1, 'string'))
        .add(new protobuf.Field('type', 2, 'string'))
        .add(new protobuf.Field('name', 3, 'string'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const RunExitRecord = new protobuf.Type('RunExitRecord')
        .add(new protobuf.Field('exit_code', 1, 'int32'))
        .add(new protobuf.Field('runtime', 2, 'int32'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const RunPreemptingRecord = new protobuf.Type('RunPreemptingRecord')
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const FinalRecord = new protobuf.Type('FinalRecord')
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const FooterRecord = new protobuf.Type('FooterRecord')
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const VersionInfo = new protobuf.Type('VersionInfo')
        .add(new protobuf.Field('producer', 1, 'string'))
        .add(new protobuf.Field('min_consumer', 2, 'string'));

    const HeaderRecord = new protobuf.Type('HeaderRecord')
        .add(new protobuf.Field('version_info', 1, 'VersionInfo'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const Request = new protobuf.Type('Request')
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    const Control = new protobuf.Type('Control')
        .add(new protobuf.Field('req_resp', 1, 'bool'))
        .add(new protobuf.Field('local', 2, 'bool'))
        .add(new protobuf.Field('relay_id', 3, 'string'))
        .add(new protobuf.Field('mailbox_slot', 4, 'string'))
        .add(new protobuf.Field('always_send', 5, 'bool'))
        .add(new protobuf.Field('flow_control', 6, 'bool'))
        .add(new protobuf.Field('end_offset', 7, 'int64'))
        .add(new protobuf.Field('connection_id', 8, 'string'));

    // Main Record type with oneof for record_type
    const Record = new protobuf.Type('Record')
        .add(new protobuf.Field('num', 1, 'int64'))
        .add(new protobuf.Field('history', 2, 'HistoryRecord'))
        .add(new protobuf.Field('summary', 3, 'SummaryRecord'))
        .add(new protobuf.Field('output', 4, 'OutputRecord'))
        .add(new protobuf.Field('config', 5, 'ConfigRecord'))
        .add(new protobuf.Field('files', 6, 'FilesRecord'))
        .add(new protobuf.Field('stats', 7, 'StatsRecord'))
        .add(new protobuf.Field('artifact', 8, 'ArtifactRecord'))
        .add(new protobuf.Field('tbrecord', 9, 'TBRecord'))
        .add(new protobuf.Field('alert', 10, 'AlertRecord'))
        .add(new protobuf.Field('telemetry', 11, 'TelemetryRecord'))
        .add(new protobuf.Field('metric', 12, 'MetricRecord'))
        .add(new protobuf.Field('output_raw', 13, 'OutputRawRecord'))
        .add(new protobuf.Field('control', 16, 'Control'))
        .add(new protobuf.Field('run', 17, 'RunRecord'))
        .add(new protobuf.Field('exit', 18, 'RunExitRecord'))
        .add(new protobuf.Field('uuid', 19, 'string'))
        .add(new protobuf.Field('final', 20, 'FinalRecord'))
        .add(new protobuf.Field('header', 21, 'HeaderRecord'))
        .add(new protobuf.Field('footer', 22, 'FooterRecord'))
        .add(new protobuf.Field('preempting', 23, 'RunPreemptingRecord'))
        .add(new protobuf.Field('use_artifact', 25, 'UseArtifactRecord'))
        .add(new protobuf.Field('environment', 26, 'EnvironmentRecord'))
        .add(new protobuf.Field('request', 100, 'Request'))
        .add(new protobuf.Field('info', 200, 'RecordInfo'));

    // Add all types to the namespace
    const ns = new protobuf.Namespace('wandb_internal');
    ns.add(RecordInfo);
    ns.add(Timestamp);
    ns.add(HistoryStep);
    ns.add(HistoryItem);
    ns.add(HistoryRecord);
    ns.add(ConfigItem);
    ns.add(ConfigRecord);
    ns.add(SummaryItem);
    ns.add(SummaryRecord);
    ns.add(StatsItem);
    ns.add(StatsRecord);
    ns.add(GitRepoRecord);
    ns.add(SettingsItem);
    ns.add(SettingsRecord);
    ns.add(TelemetryRecord);
    ns.add(BranchPoint);
    ns.add(RunRecord);
    ns.add(OutputRecord);
    ns.add(OutputRawRecord);
    ns.add(FilesItem);
    ns.add(FilesRecord);
    ns.add(ArtifactRecord);
    ns.add(TBRecord);
    ns.add(AlertRecord);
    ns.add(MetricOptions);
    ns.add(MetricSummary);
    ns.add(MetricControl);
    ns.add(MetricRecord);
    ns.add(DiskInfo);
    ns.add(MemoryInfo);
    ns.add(CpuInfo);
    ns.add(AppleInfo);
    ns.add(GpuNvidiaInfo);
    ns.add(GpuAmdInfo);
    ns.add(EnvironmentRecord);
    ns.add(UseArtifactRecord);
    ns.add(RunExitRecord);
    ns.add(RunPreemptingRecord);
    ns.add(FinalRecord);
    ns.add(FooterRecord);
    ns.add(VersionInfo);
    ns.add(HeaderRecord);
    ns.add(Request);
    ns.add(Control);
    ns.add(Record);

    protoRoot.add(ns);
    RecordType = protoRoot.lookupType('wandb_internal.Record');
}

/**
 * Parse a .wandb binary file using proper protobuf decoding.
 * This parser handles any W&B run regardless of what metrics are logged.
 */
export function parseWandbFile(filePath: string): WandbRunData {
    // Ensure protobuf schema is loaded
    loadProtoSchemaSync();

    const data = fs.readFileSync(filePath);

    const runData: WandbRunData = {
        runId: path.basename(filePath, '.wandb').replace('run-', ''),
        config: {},
        metrics: {},
        systemMetrics: {}
    };

    // Validate file header
    if (data.length < FILE_HEADER_SIZE) {
        throw new Error('Invalid wandb file: too small');
    }

    const magic = data.slice(0, 4).toString('ascii');
    if (magic !== ':W&B') {
        throw new Error('Invalid wandb file: bad magic header');
    }

    // Read all records from the file
    const records = readAllRecords(data);

    // Parse each record using protobuf
    for (const recordData of records) {
        try {
            parseProtobufRecord(recordData, runData);
        } catch (e) {
            // Skip malformed records
            continue;
        }
    }

    // Post-process: clean up and organize data
    postProcessRunData(runData);

    return runData;
}

/**
 * Determine whether a run contains at least one real time-series metric without
 * retaining its full metric/config payload. Reads one log block at a time and
 * yields between blocks so background sidebar classification does not monopolize
 * the extension host.
 */
export async function hasWandbMetricData(
    filePath: string,
    shouldContinue: () => boolean = () => true
): Promise<boolean> {
    loadProtoSchemaSync();
    if (!RecordType) {
        return false;
    }

    const file = await fs.promises.open(filePath, 'r');
    const metricSteps = new Map<string, Set<number>>();
    let pendingData: Buffer[] = [];
    let pendingLength = 0;

    const inspectRecord = (recordData: Buffer): boolean => {
        try {
            const record = RecordType!.decode(recordData) as any;
            const history = record.history;
            if (!history || !Array.isArray(history.item)) {
                return false;
            }

            const step = history.step?.num !== undefined
                ? Number(history.step.num)
                : 0;
            for (const item of history.item) {
                const key = item.key || (
                    Array.isArray(item.nested_key) && item.nested_key.length > 0
                        ? item.nested_key.join('/')
                        : ''
                );
                if (
                    !key ||
                    key === '_step' ||
                    key === '_runtime' ||
                    key === '_timestamp' ||
                    typeof item.value_json !== 'string'
                ) {
                    continue;
                }

                let value: unknown;
                try {
                    value = JSON.parse(item.value_json);
                } catch {
                    continue;
                }
                if (typeof value !== 'number' || !Number.isFinite(value)) {
                    continue;
                }

                const steps = metricSteps.get(key) || new Set<number>();
                steps.add(Number.isFinite(step) ? step : 0);
                metricSteps.set(key, steps);
                if (steps.size >= 2) {
                    return true;
                }
            }
        } catch {
            // Ignore malformed protobuf records like the full parser does.
        }
        return false;
    };

    try {
        const stats = await file.stat();
        const block = Buffer.alloc(BLOCK_SIZE);
        for (let position = 0; position < stats.size; position += BLOCK_SIZE) {
            if (!shouldContinue()) {
                throw new Error('metric-inspection-cancelled');
            }
            const { bytesRead } = await file.read(
                block,
                0,
                Math.min(BLOCK_SIZE, stats.size - position),
                position
            );
            if (bytesRead === 0) {
                break;
            }
            if (
                position === 0 &&
                (bytesRead < FILE_HEADER_SIZE || block.subarray(0, 4).toString('ascii') !== ':W&B')
            ) {
                throw new Error('Invalid wandb file header');
            }

            let offset = position === 0 ? FILE_HEADER_SIZE : 0;
            while (offset + RECORD_HEADER_SIZE <= bytesRead) {
                if (
                    block[offset] === 0 &&
                    block[offset + 1] === 0 &&
                    block[offset + 2] === 0 &&
                    block[offset + 3] === 0
                ) {
                    break;
                }

                const length = block.readUInt16LE(offset + 4);
                const recordType = block[offset + 6];
                if (recordType < RECORD_TYPE_FULL || recordType > RECORD_TYPE_LAST) {
                    offset++;
                    continue;
                }
                const payloadStart = offset + RECORD_HEADER_SIZE;
                const payloadEnd = payloadStart + length;
                if (payloadEnd > bytesRead) {
                    break;
                }
                const payload = Buffer.from(block.subarray(payloadStart, payloadEnd));
                offset = payloadEnd;

                if (recordType === RECORD_TYPE_FULL) {
                    pendingData = [];
                    pendingLength = 0;
                    if (inspectRecord(payload)) {
                        return true;
                    }
                } else if (recordType === RECORD_TYPE_FIRST) {
                    pendingData = [payload];
                    pendingLength = payload.length;
                } else if (recordType === RECORD_TYPE_MIDDLE && pendingData.length > 0) {
                    pendingLength += payload.length;
                    if (pendingLength <= MAX_INSPECTION_RECORD_BYTES) {
                        pendingData.push(payload);
                    } else {
                        pendingData = [];
                    }
                } else if (recordType === RECORD_TYPE_LAST && pendingData.length > 0) {
                    pendingLength += payload.length;
                    if (pendingLength <= MAX_INSPECTION_RECORD_BYTES) {
                        pendingData.push(payload);
                        if (inspectRecord(Buffer.concat(pendingData, pendingLength))) {
                            return true;
                        }
                    }
                    pendingData = [];
                    pendingLength = 0;
                }
            }

            await new Promise<void>(resolve => setImmediate(resolve));
        }
        return false;
    } finally {
        await file.close();
    }
}

/**
 * Read all records from the LevelDB-style log format
 */
function readAllRecords(data: Buffer): Buffer[] {
    const records: Buffer[] = [];
    let offset = FILE_HEADER_SIZE;
    let pendingData: Buffer[] = [];

    while (offset < data.length) {
        // Check if we have enough bytes for a record header
        if (offset + RECORD_HEADER_SIZE > data.length) {
            break;
        }

        // Skip padding at block boundaries (zeros)
        const blockOffset = offset % BLOCK_SIZE;
        const remainingInBlock = BLOCK_SIZE - blockOffset;

        if (remainingInBlock < RECORD_HEADER_SIZE) {
            // Skip to next block
            offset += remainingInBlock;
            continue;
        }

        // Check for padding (all zeros)
        if (data[offset] === 0 && data[offset + 1] === 0 &&
            data[offset + 2] === 0 && data[offset + 3] === 0) {
            // Skip padding
            offset += remainingInBlock;
            continue;
        }

        // Read record header
        // const crc = data.readUInt32LE(offset); // Skip CRC validation for speed
        const length = data.readUInt16LE(offset + 4);
        const recordType = data[offset + 6];

        // Validate record type
        if (recordType < 1 || recordType > 4) {
            offset++;
            continue;
        }

        // Check if we have enough data
        if (offset + RECORD_HEADER_SIZE + length > data.length) {
            break;
        }

        // Extract record data
        const recordPayload = data.slice(offset + RECORD_HEADER_SIZE, offset + RECORD_HEADER_SIZE + length);
        offset += RECORD_HEADER_SIZE + length;

        // Handle record based on type
        switch (recordType) {
            case RECORD_TYPE_FULL:
                records.push(recordPayload);
                break;
            case RECORD_TYPE_FIRST:
                pendingData = [recordPayload];
                break;
            case RECORD_TYPE_MIDDLE:
                pendingData.push(recordPayload);
                break;
            case RECORD_TYPE_LAST:
                pendingData.push(recordPayload);
                records.push(Buffer.concat(pendingData));
                pendingData = [];
                break;
        }
    }

    return records;
}

/**
 * Parse a protobuf record and extract data into runData
 */
function parseProtobufRecord(data: Buffer, runData: WandbRunData): void {
    if (!RecordType) {
        throw new Error('Protobuf schema not loaded');
    }

    const record = RecordType.decode(data) as any;

    // Handle HistoryRecord (per-step metrics logged by user via wandb.log())
    // All history items are user-logged metrics, so they go to metrics (not systemMetrics)
    if (record.history) {
        const history = record.history;
        const step = history.step?.num ? Number(history.step.num) : 0;

        if (history.item && Array.isArray(history.item)) {
            for (const item of history.item) {
                // Key can be in 'key' field or in 'nested_key' array
                const key = item.key || (item.nested_key && item.nested_key.length > 0 ? item.nested_key.join('/') : '');
                const valueJson = item.value_json;

                if (!key || !valueJson) continue;

                // Skip internal wandb fields
                if (key === '_step' || key === '_runtime' || key === '_timestamp') continue;

                try {
                    const value = JSON.parse(valueJson);
                    if (typeof value === 'number' && !isNaN(value)) {
                        // All HistoryRecord items are user-logged, so they go to metrics
                        if (!runData.metrics[key]) {
                            runData.metrics[key] = [];
                        }
                        runData.metrics[key].push({ step, value });
                    }
                } catch {
                    // Not valid JSON number, skip
                }
            }
        }
    }

    // Handle ConfigRecord
    if (record.config) {
        const config = record.config;
        if (config.update && Array.isArray(config.update)) {
            for (const item of config.update) {
                // Key can be in 'key' field or in 'nested_key' array
                const key = item.key || (item.nested_key && item.nested_key.length > 0 ? item.nested_key.join('/') : '');
                const valueJson = item.value_json;

                if (!key || !valueJson) continue;

                try {
                    const value = JSON.parse(valueJson);
                    runData.config[key] = value;
                } catch {
                    // Not valid JSON, store as string
                    runData.config[key] = valueJson;
                }
            }
        }
    }

    // Handle SummaryRecord
    if (record.summary) {
        const summary = record.summary;
        if (summary.update && Array.isArray(summary.update)) {
            for (const item of summary.update) {
                // Key can be in 'key' field or in 'nested_key' array
                const key = item.key || (item.nested_key && item.nested_key.length > 0 ? item.nested_key.join('/') : '');
                const valueJson = item.value_json;

                if (!key || !valueJson) continue;

                // Store summary values in config if they're not already there
                // and if they're not time-series metrics
                if (runData.config[key] === undefined && !runData.metrics[key]) {
                    try {
                        const value = JSON.parse(valueJson);
                        // Only store scalar values in config
                        if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || value === null) {
                            runData.config[`summary/${key}`] = value;
                        }
                    } catch {
                        // Skip invalid JSON
                    }
                }
            }
        }
    }

    // Handle RunRecord (contains project, display_name, etc.)
    if (record.run) {
        const run = record.run;
        if (run.project && !runData.project) {
            runData.project = run.project;
        }
        if (run.display_name && !runData.runName) {
            runData.runName = run.display_name;
        }
        if (run.run_id) {
            runData.runId = run.run_id;
        }

        // Extract embedded config from RunRecord
        if (run.config && run.config.update && Array.isArray(run.config.update)) {
            for (const item of run.config.update) {
                // Key can be in 'key' field or in 'nested_key' array
                const key = item.key || (item.nested_key && item.nested_key.length > 0 ? item.nested_key.join('/') : '');
                const valueJson = item.value_json;

                if (!key || !valueJson) continue;

                // Skip if already have this config
                if (runData.config[key] !== undefined) continue;

                try {
                    const value = JSON.parse(valueJson);
                    runData.config[key] = value;
                } catch {
                    runData.config[key] = valueJson;
                }
            }
        }
    }

    // Handle StatsRecord (system stats)
    if (record.stats) {
        const stats = record.stats;
        if (stats.item && Array.isArray(stats.item)) {
            for (const item of stats.item) {
                const key = item.key;
                const valueJson = item.value_json;

                if (!key || !valueJson) continue;

                try {
                    const value = JSON.parse(valueJson);
                    if (typeof value === 'number' && !isNaN(value)) {
                        if (!runData.systemMetrics[key]) {
                            runData.systemMetrics[key] = [];
                        }
                        // Stats don't have step, use current count as step
                        const step = runData.systemMetrics[key].length;
                        runData.systemMetrics[key].push({ step, value });
                    }
                } catch {
                    // Not valid JSON number, skip
                }
            }
        }
    }

    // Handle EnvironmentRecord (environment metadata)
    if (record.environment) {
        const env = record.environment;
        runData.metadata = runData.metadata || {};

        if (env.os) runData.metadata.os = env.os;
        if (env.python) runData.metadata.python = env.python;
        if (env.host) runData.metadata.host = env.host;
        if (env.program) runData.metadata.program = env.program;
        if (env.gpu_type) runData.metadata.gpu = env.gpu_type;
        if (env.gpu_count) runData.metadata.gpu_count = env.gpu_count;
        if (env.cpu_count) runData.metadata.cpu_count = env.cpu_count;
        if (env.cuda_version) runData.metadata.cuda_version = env.cuda_version;

        if (env.git) {
            runData.metadata.git = {
                remote: env.git.remote_url,
                commit: env.git.commit
            };
        }
    }
}


/**
 * Post-process run data: deduplicate, sort, and clean up
 */
function postProcessRunData(runData: WandbRunData): void {
    // Deduplicate and sort metrics
    for (const metricName of Object.keys(runData.metrics)) {
        runData.metrics[metricName] = deduplicateAndSort(runData.metrics[metricName]);
    }
    for (const metricName of Object.keys(runData.systemMetrics)) {
        runData.systemMetrics[metricName] = deduplicateAndSort(runData.systemMetrics[metricName]);
    }

    // Remove metrics with too few points (likely config values, not time series)
    const minPoints = 2;
    for (const metricName of Object.keys(runData.metrics)) {
        if (runData.metrics[metricName].length < minPoints) {
            delete runData.metrics[metricName];
        }
    }

    // Remove internal keys from config
    const internalKeys = ['_wandb', 'wandb_version'];
    for (const key of internalKeys) {
        delete runData.config[key];
    }

    // Clean up config: extract nested "value" objects (wandb stores config as {value: X})
    for (const key of Object.keys(runData.config)) {
        const val = runData.config[key];
        if (val && typeof val === 'object' && 'value' in val && Object.keys(val).length === 1) {
            runData.config[key] = val.value;
        }
    }
}

/**
 * Deduplicate metric points by step (keep last value) and sort by step
 */
function deduplicateAndSort(points: MetricPoint[]): MetricPoint[] {
    // Sort by step
    points.sort((a, b) => a.step - b.step);

    // Deduplicate by step, keeping last value
    const seen = new Map<number, MetricPoint>();
    for (const point of points) {
        seen.set(point.step, point);
    }

    return Array.from(seen.values()).sort((a, b) => a.step - b.step);
}

/**
 * Parse output.log file to extract training metrics.
 * This serves as a fallback/supplement to wandb binary parsing.
 */
export function parseOutputLog(logPath: string): WandbMetrics {
    const metrics: WandbMetrics = {};

    if (!fs.existsSync(logPath)) {
        return metrics;
    }

    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n');

    let stepNum = 0;

    for (const line of lines) {
        // Try to extract step/iteration number
        const iterMatch = line.match(/(?:iter|step|iteration)[:\s]*(\d+)/i);
        if (iterMatch) {
            stepNum = parseInt(iterMatch[1], 10);
        }

        // Extract metrics from the line
        const metricPattern = /([a-zA-Z_][a-zA-Z0-9_\s]*?):\s*([\d.eE+-]+)/g;
        let match;

        while ((match = metricPattern.exec(line)) !== null) {
            const rawKey = match[1].trim().toLowerCase().replace(/\s+/g, '_');
            const value = parseFloat(match[2]);

            if (!isNaN(value) && rawKey.length > 1) {
                if (!metrics[rawKey]) {
                    metrics[rawKey] = [];
                }

                // Avoid duplicates at the same step
                const existing = metrics[rawKey].find(p => p.step === stepNum);
                if (!existing) {
                    metrics[rawKey].push({ step: stepNum, value });
                }
            }
        }
    }

    // Sort all metrics by step
    for (const key of Object.keys(metrics)) {
        metrics[key].sort((a, b) => a.step - b.step);
    }

    return metrics;
}

/**
 * Find the .wandb file in a directory
 */
export function findWandbFile(dirPath: string): string | null {
    try {
        const files = fs.readdirSync(dirPath);
        const wandbFile = files.find(f => f.endsWith('.wandb'));
        return wandbFile ? path.join(dirPath, wandbFile) : null;
    } catch {
        return null;
    }
}

/**
 * Check if a directory contains a W&B run
 */
export function isWandbRunDirectory(dirPath: string): boolean {
    return findWandbFile(dirPath) !== null;
}

/**
 * Get all available files in a W&B run directory
 */
export function getRunFiles(dirPath: string): {
    wandbFile: string | null;
    outputLog: string | null;
    metadata: string | null;
    configYaml: string | null;
    summaryJson: string | null;
} {
    const wandbFile = findWandbFile(dirPath);

    const outputLog = fs.existsSync(path.join(dirPath, 'files', 'output.log'))
        ? path.join(dirPath, 'files', 'output.log')
        : null;

    const metadata = fs.existsSync(path.join(dirPath, 'files', 'wandb-metadata.json'))
        ? path.join(dirPath, 'files', 'wandb-metadata.json')
        : null;

    const configYaml = fs.existsSync(path.join(dirPath, 'files', 'config.yaml'))
        ? path.join(dirPath, 'files', 'config.yaml')
        : null;

    const summaryJson = fs.existsSync(path.join(dirPath, 'files', 'wandb-summary.json'))
        ? path.join(dirPath, 'files', 'wandb-summary.json')
        : null;

    return { wandbFile, outputLog, metadata, configYaml, summaryJson };
}
