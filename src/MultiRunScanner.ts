import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as protobuf from 'protobufjs';

export interface RunScanResult {
    filePath: string;
    runId: string;
    runName: string;
    project?: string;
    lastModified: number;
    fileSize: number;
    isVisible: boolean;
}

export interface FileChangeEvent {
    type: 'added' | 'modified' | 'deleted';
    filePath: string;
    metadata?: RunScanResult;
}

const DEBOUNCE_MS = 1500;
const POLL_INTERVAL_MS = 5000;

/**
 * Recursively scan a folder for all .wandb files
 */
export async function scanFolderForRuns(folderPath: string): Promise<RunScanResult[]> {
    const results: RunScanResult[] = [];

    async function scanDirectory(dirPath: string): Promise<void> {
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    // Recursively scan subdirectories
                    await scanDirectory(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.wandb')) {
                    // Found a .wandb file
                    try {
                        const metadata = await quickParseMetadata(fullPath);
                        results.push(metadata);
                    } catch (error) {
                        console.error(`Failed to parse metadata from ${fullPath}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error(`Failed to scan directory ${dirPath}:`, error);
        }
    }

    await scanDirectory(folderPath);
    return results;
}

/**
 * Quickly extract run metadata without full parsing
 * Only reads the file header to get runId and runName
 */
export async function quickParseMetadata(filePath: string): Promise<RunScanResult> {
    const stats = await fs.promises.stat(filePath);

    // Extract runId from filename as fallback
    let runId = path.basename(filePath, '.wandb').replace('run-', '');
    let runName = runId;
    let project: string | undefined = undefined;

    try {
        // Read only first 16KB to find RunRecord (avoid reading entire file)
        const buffer = Buffer.alloc(16384);
        const fd = await fs.promises.open(filePath, 'r');
        await fd.read(buffer, 0, 16384, 0);
        await fd.close();

        // Parse protobuf records from the header
        const records = readRecordsFromBuffer(buffer);

        // Look for RunRecord to extract metadata
        for (const recordData of records) {
            try {
                const record = await decodeRecord(recordData);
                if (record && record.run) {
                    runId = record.run.run_id || runId;
                    runName = record.run.display_name || record.run.run_id || runId;
                    project = record.run.project;
                    break; // Found what we need
                }
            } catch (error) {
                // Skip malformed records
                continue;
            }
        }
    } catch (error) {
        // If parsing fails, use filename-based values
        console.warn(`Could not parse metadata from ${filePath}, using filename:`, error);
    }

    return {
        filePath,
        runId,
        runName,
        project,
        lastModified: stats.mtimeMs,
        fileSize: stats.size,
        isVisible: true // Auto-select by default
    };
}

/**
 * Watch a folder for changes to .wandb files
 */
export function watchFolder(
    folderPath: string,
    callback: (event: FileChangeEvent) => void,
    isActive: () => boolean = () => true
): vscode.Disposable {
    const watchedFiles = new Map<string, { lastModified: number; fileSize: number }>();
    const pendingPaths = new Set<string>();
    const forcedModifiedPaths = new Set<string>();
    const initializationChanges = new Set<string>();
    let processTimer: NodeJS.Timeout | null = null;
    let processing = false;
    let initializing = true;
    let disposed = false;

    // Initial scan to populate watchedFiles
    scanFolderForRuns(folderPath).then(runs => {
        if (disposed) {
            return;
        }

        runs.forEach(run => {
            watchedFiles.set(run.filePath, {
                lastModified: run.lastModified,
                fileSize: run.fileSize
            });
        });
    }).catch(error => {
        console.error(`Could not initialize folder watcher for ${folderPath}:`, error);
    }).finally(() => {
        initializing = false;

        // A file may change after the viewer's scan but before this baseline scan
        // reaches it. Preserve those watcher events and force one notification so
        // the newer baseline cannot silently leave older parsed data cached.
        for (const filePath of initializationChanges) {
            pendingPaths.add(filePath);
            forcedModifiedPaths.add(filePath);
        }
        initializationChanges.clear();

        if (
            !disposed &&
            pendingPaths.size > 0 &&
            isActive() &&
            !processTimer &&
            !processing
        ) {
            processTimer = setTimeout(processPendingPaths, DEBOUNCE_MS);
        }
    });

    const processPath = async (filePath: string): Promise<void> => {
        try {
            const exists = fs.existsSync(filePath);
            const forceModified = forcedModifiedPaths.has(filePath);

            if (!exists && (watchedFiles.has(filePath) || forceModified)) {
                watchedFiles.delete(filePath);
                forcedModifiedPaths.delete(filePath);
                callback({
                    type: 'deleted',
                    filePath
                });
                return;
            }

            if (!exists) {
                return;
            }

            const stats = await fs.promises.stat(filePath);
            const previousVersion = watchedFiles.get(filePath);

            if (previousVersion === undefined) {
                const metadata = await quickParseMetadata(filePath);
                watchedFiles.set(filePath, {
                    lastModified: metadata.lastModified,
                    fileSize: metadata.fileSize
                });
                forcedModifiedPaths.delete(filePath);
                callback({
                    type: 'added',
                    filePath,
                    metadata
                });
            } else if (
                forceModified ||
                stats.mtimeMs !== previousVersion.lastModified ||
                stats.size !== previousVersion.fileSize
            ) {
                const metadata = await quickParseMetadata(filePath);
                watchedFiles.set(filePath, {
                    lastModified: metadata.lastModified,
                    fileSize: metadata.fileSize
                });
                forcedModifiedPaths.delete(filePath);
                callback({
                    type: 'modified',
                    filePath,
                    metadata
                });
            }
        } catch (error) {
            console.error(`Error processing file change for ${filePath}:`, error);
        }
    };

    const processPendingPaths = async (): Promise<void> => {
        processTimer = null;
        if (disposed || processing || !isActive()) {
            return;
        }

        processing = true;
        const paths = Array.from(pendingPaths);
        pendingPaths.clear();

        try {
            for (const filePath of paths) {
                await processPath(filePath);
            }
        } finally {
            processing = false;
            if (!disposed && pendingPaths.size > 0 && isActive()) {
                processTimer = setTimeout(processPendingPaths, DEBOUNCE_MS);
            }
        }
    };

    const queuePath = (filePath: string): void => {
        if (disposed || !isActive()) {
            return;
        }

        if (initializing) {
            initializationChanges.add(filePath);
            return;
        }

        pendingPaths.add(filePath);
        if (!processTimer && !processing) {
            // Do not reset this timer on every write. This makes the debounce a
            // throttle, so continuously appended runs still refresh regularly.
            processTimer = setTimeout(processPendingPaths, DEBOUNCE_MS);
        }
    };

    // Watch the folder recursively
    const watcher = fs.watch(folderPath, { recursive: true }, (_eventType, filename) => {
        if (!filename || !filename.endsWith('.wandb')) {
            return;
        }

        queuePath(path.join(folderPath, filename));
    });

    // fs.watch is best-effort on some filesystems. Check known files occasionally
    // while the viewer is visible so a missed modification is still detected.
    const pollTimer = setInterval(() => {
        if (disposed || !isActive()) {
            return;
        }

        for (const filePath of watchedFiles.keys()) {
            queuePath(filePath);
        }
    }, POLL_INTERVAL_MS);

    return {
        dispose: () => {
            disposed = true;
            if (processTimer) {
                clearTimeout(processTimer);
            }
            clearInterval(pollTimer);
            pendingPaths.clear();
            forcedModifiedPaths.clear();
            initializationChanges.clear();
            watcher.close();
        }
    };
}

/**
 * Read protobuf records from a buffer (LevelDB log format)
 */
function readRecordsFromBuffer(buffer: Buffer): Buffer[] {
    const records: Buffer[] = [];
    const RECORD_HEADER_SIZE = 7;
    const FILE_HEADER_SIZE = 7;

    let offset = FILE_HEADER_SIZE; // Skip ":W&B" + 3 bytes header

    while (offset < buffer.length - RECORD_HEADER_SIZE) {
        // Read record header
        const checksum = buffer.readUInt32LE(offset);
        const length = buffer.readUInt16LE(offset + 4);
        const type = buffer.readUInt8(offset + 6);

        offset += RECORD_HEADER_SIZE;

        if (offset + length > buffer.length) {
            break; // Reached end of available data
        }

        // Extract record data
        const recordData = buffer.slice(offset, offset + length);
        records.push(recordData);

        offset += length;

        // Only read a few records (we're just looking for RunRecord)
        if (records.length >= 10) {
            break;
        }
    }

    return records;
}

/**
 * Decode a protobuf record
 */
async function decodeRecord(data: Buffer): Promise<any> {
    // Load protobuf schema (reuse from wandbParser.ts pattern)
    const protoRoot = await loadProtoSchema();
    const RecordType = protoRoot.lookupType('wandb_internal.Record');

    return RecordType.decode(data);
}

/**
 * Load protobuf schema (similar to wandbParser.ts)
 */
let cachedProtoRoot: protobuf.Root | null = null;

async function loadProtoSchema(): Promise<protobuf.Root> {
    if (cachedProtoRoot) {
        return cachedProtoRoot;
    }

    // Build protobuf schema programmatically (minimal version for RunRecord)
    const root = new protobuf.Root();

    // Define minimal schema needed for quick metadata extraction
    const wandbInternal = root.define('wandb_internal');

    wandbInternal.add(new protobuf.Type('Record')
        .add(new protobuf.Field('num', 1, 'int64'))
        .add(new protobuf.Field('run', 17, 'RunRecord'))
    );

    wandbInternal.add(new protobuf.Type('RunRecord')
        .add(new protobuf.Field('run_id', 1, 'string'))
        .add(new protobuf.Field('project', 3, 'string'))
        .add(new protobuf.Field('display_name', 8, 'string'))
    );

    cachedProtoRoot = root;
    return root;
}
