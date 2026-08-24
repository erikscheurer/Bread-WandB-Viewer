import { RunScanResult } from './MultiRunScanner';
import {
    WandbRunData,
    hasWandbMetricData,
    parseWandbFile,
    MetricPoint
} from './wandbParser';
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

/**
 * Reduce a metric series before it crosses the extension-host/webview boundary.
 * The parsed run cache retains the complete series for AI export and summaries.
 */
export function downsampleMetricPoints(
    points: MetricPoint[],
    maxPoints: number
): MetricPoint[] {
    if (maxPoints <= 0 || points.length <= maxPoints) {
        return points;
    }
    if (maxPoints === 1) {
        return [points[points.length - 1]];
    }
    if (maxPoints === 2) {
        return [points[0], points[points.length - 1]];
    }

    // Largest-Triangle-Three-Buckets preserves spikes and curve shape much
    // better than selecting every nth point while keeping both endpoints.
    const sampled: MetricPoint[] = [points[0]];
    const bucketWidth = (points.length - 2) / (maxPoints - 2);
    let previousIndex = 0;

    for (let bucket = 0; bucket < maxPoints - 2; bucket++) {
        const averageStart = Math.min(
            Math.floor((bucket + 1) * bucketWidth) + 1,
            points.length
        );
        const averageEnd = Math.min(
            Math.floor((bucket + 2) * bucketWidth) + 1,
            points.length
        );
        const averageRangeEnd = Math.max(averageEnd, averageStart + 1);
        let averageStep = 0;
        let averageValue = 0;
        let averageCount = 0;

        for (
            let index = averageStart;
            index < averageRangeEnd && index < points.length;
            index++
        ) {
            averageStep += points[index].step;
            averageValue += points[index].value;
            averageCount++;
        }
        if (averageCount === 0) {
            averageStep = points[points.length - 1].step;
            averageValue = points[points.length - 1].value;
            averageCount = 1;
        }
        averageStep /= averageCount;
        averageValue /= averageCount;

        const rangeStart = Math.floor(bucket * bucketWidth) + 1;
        const rangeEnd = Math.min(
            Math.floor((bucket + 1) * bucketWidth) + 1,
            points.length - 1
        );
        const previousPoint = points[previousIndex];
        let selectedIndex = rangeStart;
        let largestArea = -1;

        for (let index = rangeStart; index < rangeEnd; index++) {
            const point = points[index];
            const area = Math.abs(
                (previousPoint.step - averageStep) *
                    (point.value - previousPoint.value) -
                (previousPoint.step - point.step) *
                    (averageValue - previousPoint.value)
            );
            if (area > largestArea) {
                largestArea = area;
                selectedIndex = index;
            }
        }

        sampled.push(points[selectedIndex]);
        previousIndex = selectedIndex;
    }

    sampled.push(points[points.length - 1]);
    return sampled;
}

export class MultiRunManager {
    private state: MultiRunState;
    private cacheAccessOrder: string[] = []; // For LRU eviction
    private colorPalette: RunColorPaletteName;
    private customRunColors: Readonly<Record<string, string>>;
    private runContentStatuses = new Map<string, RunContentStatus>();
    private readonly selectNewRuns: boolean;

    constructor(
        folderPath: string,
        colorPalette: RunColorPaletteName = DEFAULT_RUN_COLOR_PALETTE,
        customRunColors: Readonly<Record<string, string>> = {},
        selectNewRuns: boolean = true
    ) {
        this.colorPalette = colorPalette;
        this.customRunColors = customRunColors;
        this.selectNewRuns = selectNewRuns;
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
        if (runResult.isVisible && this.selectNewRuns) {
            this.state.selectedRunIds.add(runResult.runId);
        }

        if (!this.state.colorMap.has(runResult.runId)) {
            this.state.colorMap.set(
                runResult.runId,
                this.customRunColors[runResult.runId] ||
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
            this.evictIfNeeded();
            return false;
        } else {
            this.state.selectedRunIds.add(runId);
            return true;
        }
    }

    /**
     * Set run visibility explicitly. Returns false when the run is unknown.
     */
    setRunSelected(runId: string, selected: boolean): boolean {
        if (!this.state.runs.has(runId)) {
            return false;
        }

        if (selected) {
            this.state.selectedRunIds.add(runId);
        } else {
            this.state.selectedRunIds.delete(runId);
            this.evictIfNeeded();
        }
        return true;
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
        this.evictIfNeeded();
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
        this.evictIfNeeded();
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
     * Classify an unparsed run without adding its full contents to the LRU.
     * Returns true only when a current unknown status was resolved.
     */
    async inspectRunContentStatus(
        runId: string,
        shouldContinue: () => boolean = () => true
    ): Promise<boolean> {
        if (this.getRunContentStatus(runId) !== 'unknown') {
            return false;
        }
        const run = this.state.runs.get(runId);
        if (!run) {
            return false;
        }

        const inspectedLastModified = run.lastModified;
        const inspectedFileSize = run.fileSize;
        try {
            const hasData = await hasWandbMetricData(run.filePath, shouldContinue);
            const currentRun = this.state.runs.get(runId);
            if (
                !currentRun ||
                currentRun.lastModified !== inspectedLastModified ||
                currentRun.fileSize !== inspectedFileSize ||
                this.getRunContentStatus(runId) !== 'unknown'
            ) {
                return false;
            }
            this.runContentStatuses.set(runId, hasData ? 'has-data' : 'empty');
            return true;
        } catch {
            return false;
        }
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
     * Apply extension-global per-run colors without changing palette defaults.
     */
    setCustomRunColors(customRunColors: Readonly<Record<string, string>>): void {
        this.customRunColors = customRunColors;
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

        // Reserve explicit colors before assigning palette entries to other runs.
        // User-selected duplicates remain valid because they are intentional.
        for (const runId of runIds) {
            const customColor = this.customRunColors[runId];
            if (customColor) {
                this.state.colorMap.set(runId, customColor);
            }
        }

        for (const runId of runIds) {
            if (!this.state.colorMap.has(runId)) {
                this.state.colorMap.set(runId, this.assignRunColor(runId));
            }
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
                            this.hasRunMetricData(parsed) ? 'has-data' : 'empty'
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

    private hasRunMetricData(runData: WandbRunData): boolean {
        return Object.values(runData.metrics)
            .some(points => points.length > 0);
    }

    /**
     * Merge metrics from selected runs
     */
    mergeMetrics(maxPointsPerSeries: number = 0): {
        training: MergedMetric[],
        system: MergedMetric[]
    } {
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
                    data: downsampleMetricPoints(
                        metricData as MetricPoint[],
                        maxPointsPerSeries
                    )
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
                    data: downsampleMetricPoints(
                        metricData as MetricPoint[],
                        maxPointsPerSeries
                    )
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
        let deselectedCacheSize = Array.from(this.state.parsedData.keys())
            .filter(runId => !this.state.selectedRunIds.has(runId))
            .length;
        while (deselectedCacheSize > MAX_CACHE_SIZE) {
            const lruIndex = this.cacheAccessOrder.findIndex(
                runId => !this.state.selectedRunIds.has(runId)
            );
            if (lruIndex === -1) {
                // Selected runs must stay parsed so every selected dataset can be
                // merged. The cache shrinks again as runs are deselected.
                break;
            }
            const [lruRunId] = this.cacheAccessOrder.splice(lruIndex, 1);
            this.state.parsedData.delete(lruRunId);
            deselectedCacheSize--;
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
                const index = this.cacheAccessOrder.indexOf(runResult.runId);
                if (index > -1) {
                    this.cacheAccessOrder.splice(index, 1);
                }
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
