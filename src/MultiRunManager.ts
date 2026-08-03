import { RunScanResult } from './MultiRunScanner';
import { WandbRunData, WandbMetrics, parseWandbFile, MetricPoint } from './wandbParser';
import {
    DEFAULT_RUN_COLOR_PALETTE,
    getStableRunColorIndex,
    RUN_COLOR_PALETTES,
    RunColorPaletteName
} from './runColors';

export interface MergedMetric {
    metricName: string;
    datasets: Array<{
        runId: string;
        runName: string;
        color: string;
        data: MetricPoint[];
    }>;
}

export interface MultiRunState {
    runs: Map<string, RunScanResult>;
    parsedData: Map<string, WandbRunData>;
    selectedRunIds: Set<string>;
    colorMap: Map<string, string>;
    folderPath: string;
}

export type RunContentStatus = 'unknown' | 'empty' | 'has-data';

const MAX_CACHE_SIZE = 20;

export class MultiRunManager {
    private state: MultiRunState;
    private cacheAccessOrder: string[] = []; // For LRU eviction
    private colorPalette: RunColorPaletteName;
    private runContentStatuses = new Map<string, RunContentStatus>();

    constructor(
        folderPath: string,
        colorPalette: RunColorPaletteName = DEFAULT_RUN_COLOR_PALETTE
    ) {
        this.colorPalette = colorPalette;
        this.state = {
            runs: new Map(),
            parsedData: new Map(),
            selectedRunIds: new Set(),
            colorMap: new Map(),
            folderPath
        };
    }

    /**
     * Add a run to the manager
     */
    addRun(runResult: RunScanResult): void {
        this.state.runs.set(runResult.runId, runResult);

        // Auto-select new runs
        if (runResult.isVisible) {
            this.state.selectedRunIds.add(runResult.runId);
        }

        if (!this.state.colorMap.has(runResult.runId)) {
            this.state.colorMap.set(
                runResult.runId,
                this.assignRunColor(runResult.runId)
            );
        }
    }

    /**
     * Remove a run from the manager
     */
    removeRun(runId: string): void {
        this.state.runs.delete(runId);
        this.state.selectedRunIds.delete(runId);
        this.state.parsedData.delete(runId);
        this.state.colorMap.delete(runId);
        this.runContentStatuses.delete(runId);

        // Remove from cache access order
        const index = this.cacheAccessOrder.indexOf(runId);
        if (index > -1) {
            this.cacheAccessOrder.splice(index, 1);
        }
    }

    /**
     * Toggle run visibility
     */
    toggleRun(runId: string): boolean {
        if (this.state.selectedRunIds.has(runId)) {
            this.state.selectedRunIds.delete(runId);
            return false;
        } else {
            this.state.selectedRunIds.add(runId);
            return true;
        }
    }

    /**
     * Select all runs
     */
    selectAll(): void {
        this.state.runs.forEach((run, runId) => {
            this.state.selectedRunIds.add(runId);
        });
    }

    /**
     * Deselect all runs
     */
    deselectAll(): void {
        this.state.selectedRunIds.clear();
    }

    /**
     * Select one run and hide every other run.
     */
    selectOnly(runId: string): boolean {
        if (!this.state.runs.has(runId)) {
            return false;
        }

        this.state.selectedRunIds.clear();
        this.state.selectedRunIds.add(runId);
        return true;
    }

    /**
     * Get all runs
     */
    getRuns(): RunScanResult[] {
        return Array.from(this.state.runs.values());
    }

    /**
     * Get selected run IDs
     */
    getSelectedRunIds(): string[] {
        return Array.from(this.state.selectedRunIds);
    }

    /**
     * Check if run is selected
     */
    isRunSelected(runId: string): boolean {
        return this.state.selectedRunIds.has(runId);
    }

    /**
     * Get run color
     */
    getRunColor(runId: string): string {
        return this.state.colorMap.get(runId) || '#888888';
    }

    getRunContentStatus(runId: string): RunContentStatus {
        return this.runContentStatuses.get(runId) || 'unknown';
    }

    /**
     * Reassign every run color when the configured palette changes.
     */
    setColorPalette(colorPalette: RunColorPaletteName): void {
        if (this.colorPalette === colorPalette) {
            return;
        }

        this.colorPalette = colorPalette;
        this.rebuildRunColors();
    }

    /**
     * Start at the run's stable hash position and probe for an unused palette
     * entry. A color is only reused once every color in the palette is occupied.
     */
    private assignRunColor(runId: string): string {
        const palette = RUN_COLOR_PALETTES[this.colorPalette];
        const usedColors = new Set(this.state.colorMap.values());
        const startIndex = getStableRunColorIndex(runId, this.colorPalette);

        for (let offset = 0; offset < palette.length; offset++) {
            const color = palette[(startIndex + offset) % palette.length];
            if (!usedColors.has(color)) {
                return color;
            }
        }

        return palette[startIndex];
    }

    private rebuildRunColors(): void {
        this.state.colorMap.clear();
        const runIds = Array.from(this.state.runs.keys())
            .sort((left, right) => left.localeCompare(right));

        for (const runId of runIds) {
            this.state.colorMap.set(runId, this.assignRunColor(runId));
        }
    }

    /**
     * Parse selected runs (lazy loading)
     */
    async parseSelectedRuns(): Promise<void> {
        const selectedRuns = Array.from(this.state.selectedRunIds);

        for (const runId of selectedRuns) {
            if (!this.state.parsedData.has(runId)) {
                const run = this.state.runs.get(runId);
                if (run) {
                    try {
                        const parseStart = Date.now();
                        const parsed = parseWandbFile(run.filePath);
                        const parseTime = Date.now() - parseStart;
                        console.log(`  - Parsed run ${run.runName}: ${parseTime}ms (${Object.keys(parsed.metrics).length} metrics, ${Object.values(parsed.metrics).reduce((sum, m) => sum + m.length, 0)} data points)`);
                        this.state.parsedData.set(runId, parsed);
                        this.runContentStatuses.set(
                            runId,
                            this.hasMetricData(parsed) ? 'has-data' : 'empty'
                        );
                        this.updateCacheAccess(runId);
                        this.evictIfNeeded();
                    } catch (error) {
                        this.runContentStatuses.set(runId, 'unknown');
                        console.error(`Failed to parse run ${runId}:`, error);
                    }
                }
            } else {
                // Update cache access order
                this.updateCacheAccess(runId);
            }
        }
    }

    /**
     * Invalidate cached data for selected runs so they are parsed from disk again.
     */
    invalidateSelectedRuns(): void {
        for (const runId of this.state.selectedRunIds) {
            this.state.parsedData.delete(runId);
            this.runContentStatuses.set(runId, 'unknown');

            const index = this.cacheAccessOrder.indexOf(runId);
            if (index > -1) {
                this.cacheAccessOrder.splice(index, 1);
            }
        }
    }

    /**
     * Get parsed data for a run (may be null if not parsed yet)
     */
    getParsedData(runId: string): WandbRunData | undefined {
        return this.state.parsedData.get(runId);
    }

    private hasMetricData(runData: WandbRunData): boolean {
        return [runData.metrics, runData.systemMetrics].some(metrics =>
            Object.values(metrics).some(points => points.length > 0)
        );
    }

    /**
     * Merge metrics from selected runs
     */
    mergeMetrics(): { training: MergedMetric[], system: MergedMetric[] } {
        const trainingMetrics = new Map<string, MergedMetric>();
        const systemMetrics = new Map<string, MergedMetric>();

        // Collect all metric names first
        for (const runId of this.state.selectedRunIds) {
            const data = this.state.parsedData.get(runId);
            if (!data) continue;

            const run = this.state.runs.get(runId);
            if (!run) continue;

            const color = this.getRunColor(runId);

            // Process training metrics
            for (const [metricName, metricData] of Object.entries(data.metrics)) {
                if (!trainingMetrics.has(metricName)) {
                    trainingMetrics.set(metricName, {
                        metricName,
                        datasets: []
                    });
                }

                trainingMetrics.get(metricName)!.datasets.push({
                    runId,
                    runName: run.runName,
                    color,
                    data: metricData as MetricPoint[]
                });
            }

            // Process system metrics
            for (const [metricName, metricData] of Object.entries(data.systemMetrics)) {
                if (!systemMetrics.has(metricName)) {
                    systemMetrics.set(metricName, {
                        metricName,
                        datasets: []
                    });
                }

                systemMetrics.get(metricName)!.datasets.push({
                    runId,
                    runName: run.runName,
                    color,
                    data: metricData as MetricPoint[]
                });
            }
        }

        return {
            training: Array.from(trainingMetrics.values()),
            system: Array.from(systemMetrics.values())
        };
    }

    /**
     * Get count of selected runs
     */
    getSelectedCount(): number {
        return this.state.selectedRunIds.size;
    }

    /**
     * Get total count of runs
     */
    getTotalCount(): number {
        return this.state.runs.size;
    }

    /**
     * Update cache access order for LRU
     */
    private updateCacheAccess(runId: string): void {
        // Remove from current position
        const index = this.cacheAccessOrder.indexOf(runId);
        if (index > -1) {
            this.cacheAccessOrder.splice(index, 1);
        }

        // Add to end (most recently used)
        this.cacheAccessOrder.push(runId);
    }

    /**
     * Evict least recently used entries if cache is too large
     */
    private evictIfNeeded(): void {
        while (this.state.parsedData.size > MAX_CACHE_SIZE) {
            const lruRunId = this.cacheAccessOrder.shift();
            if (lruRunId) {
                this.state.parsedData.delete(lruRunId);
            }
        }
    }

    /**
     * Update run metadata (when file is modified)
     */
    updateRun(runResult: RunScanResult): void {
        const existingRun = this.state.runs.get(runResult.runId);
        if (existingRun) {
            // Update metadata
            this.state.runs.set(runResult.runId, runResult);

            // Invalidate cached data if file was modified
            if (
                existingRun.lastModified !== runResult.lastModified ||
                existingRun.fileSize !== runResult.fileSize
            ) {
                this.state.parsedData.delete(runResult.runId);
                this.runContentStatuses.set(runResult.runId, 'unknown');
            }
        }
    }

    /**
     * Get state snapshot for serialization
     */
    getState(): MultiRunState {
        return this.state;
    }
}
