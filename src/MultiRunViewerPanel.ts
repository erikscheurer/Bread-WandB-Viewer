import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MultiRunManager, MergedMetric } from './MultiRunManager';
import { scanFolderForRuns, watchFolder, FileChangeEvent, RunScanResult } from './MultiRunScanner';
import { getChartStyles, getChartScript, getModalHtml, getControlsBarHtml } from './chartTemplate';
import { generateAIContext, calculateTokenEstimate } from './aiContext/ContextGenerator';

export class MultiRunViewerPanel {
    public static currentPanel: MultiRunViewerPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _manager: MultiRunManager;
    private _folderWatcher: vscode.Disposable | null = null;
    private _folderPath: string;
    private _pendingFileChanges = new Map<string, FileChangeEvent>();
    private _processingFileChanges = false;
    private _needsVisibleCatchUp = false;
    private _disposed = false;

    public static createOrShow(extensionUri: vscode.Uri, folderPath: string) {
        if (MultiRunViewerPanel.currentPanel) {
            MultiRunViewerPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'wandbMultiRunViewer',
            'Bread Wandb Viewer',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        MultiRunViewerPanel.currentPanel = new MultiRunViewerPanel(panel, extensionUri, folderPath);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, folderPath: string) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._folderPath = folderPath;
        this._manager = new MultiRunManager(folderPath);

        // Show loading screen immediately
        this._panel.webview.html = this._getLoadingHtml();
        
        // Defer the actual work so loading spinner can render
        setTimeout(() => {
            this._update();
        }, 50); // 50ms delay allows the loading screen to paint
        
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'toggleRun':
                        this._manager.toggleRun(message.runId);
                        await this._update(false);
                        break;
                    case 'selectAll':
                        this._manager.selectAll();
                        await this._update(false);
                        break;
                    case 'deselectAll':
                        this._manager.deselectAll();
                        await this._update(false);
                        break;
                    case 'reloadSelectedRuns':
                        try {
                            await this._reloadSelectedRuns();
                        } catch {
                            vscode.window.showErrorMessage('Failed to reload the selected runs.');
                        } finally {
                            await this._panel.webview.postMessage({
                                command: 'reloadSelectedRunsComplete',
                                canReload: this._manager.getSelectedCount() > 0
                            });
                        }
                        break;
                    case 'rediscoverRuns':
                        try {
                            const discoveredCount = await this._rediscoverRuns();
                            const message = discoveredCount === 0
                                ? 'No new runs found.'
                                : discoveredCount === 1
                                    ? 'Discovered 1 new run.'
                                    : `Discovered ${discoveredCount} new runs.`;
                            vscode.window.showInformationMessage(message);
                        } catch {
                            vscode.window.showErrorMessage('Failed to rediscover runs.');
                        } finally {
                            await this._panel.webview.postMessage({
                                command: 'rediscoverRunsComplete'
                            });
                        }
                        break;
                    case 'generateAIContext':
                        await this._handleGenerateAIContext(message.action);
                        break;
                    case 'saveChartImage':
                        await this._handleSaveChartImage(message.imageBase64, message.chartCount);
                        break;
                    case 'copyChartImageFallback':
                        await this._handleCopyChartImageFallback(message.imageBase64);
                        break;
                    case 'showWarning':
                        vscode.window.showWarningMessage(message.message);
                        break;
                }
            },
            null,
            this._disposables
        );

        this._panel.onDidChangeViewState(event => {
            if (!event.webviewPanel.visible) {
                this._needsVisibleCatchUp = true;
                return;
            }

            if (this._needsVisibleCatchUp) {
                this._needsVisibleCatchUp = false;
                void this._queueVisibleCatchUp();
            } else {
                void this._processPendingFileChanges();
            }
        }, null, this._disposables);

        // Watch for file changes only while the panel is visible. When it becomes
        // visible again, a metadata scan catches up on changes made while hidden.
        this._folderWatcher = watchFolder(
            folderPath,
            event => this._queueFileChange(event),
            () => this._panel.visible && !this._disposed
        );
    }

    private async _reloadSelectedRuns(): Promise<void> {
        if (this._manager.getSelectedCount() === 0) {
            vscode.window.showInformationMessage('Select at least one run to reload.');
            return;
        }

        this._manager.invalidateSelectedRuns();
        await this._refreshRunDataInWebview();
    }

    private _queueFileChange(event: FileChangeEvent): void {
        this._pendingFileChanges.set(event.filePath, event);
        void this._processPendingFileChanges();
    }

    private async _queueVisibleCatchUp(): Promise<void> {
        try {
            const discoveredRuns = await scanFolderForRuns(this._folderPath);
            const existingRuns = new Map(
                this._manager.getRuns().map(run => [run.runId, run])
            );
            const discoveredRunIds = new Set(discoveredRuns.map(run => run.runId));

            for (const run of discoveredRuns) {
                const existingRun = existingRuns.get(run.runId);
                if (!existingRun) {
                    this._pendingFileChanges.set(run.filePath, {
                        type: 'added',
                        filePath: run.filePath,
                        metadata: run
                    });
                } else if (
                    existingRun.lastModified !== run.lastModified ||
                    existingRun.fileSize !== run.fileSize
                ) {
                    this._pendingFileChanges.set(run.filePath, {
                        type: 'modified',
                        filePath: run.filePath,
                        metadata: run
                    });
                }
            }

            for (const existingRun of existingRuns.values()) {
                if (!discoveredRunIds.has(existingRun.runId)) {
                    this._pendingFileChanges.set(existingRun.filePath, {
                        type: 'deleted',
                        filePath: existingRun.filePath
                    });
                }
            }

            await this._processPendingFileChanges();
        } catch (error) {
            console.error('Failed to catch up on run changes:', error);
        }
    }

    private async _processPendingFileChanges(): Promise<void> {
        if (
            this._processingFileChanges ||
            this._disposed ||
            !this._panel.visible
        ) {
            return;
        }

        this._processingFileChanges = true;

        try {
            while (this._pendingFileChanges.size > 0 && this._panel.visible) {
                const changes = Array.from(this._pendingFileChanges.values());
                this._pendingFileChanges.clear();

                if (changes.some(change => change.type !== 'modified')) {
                    await this._update(true);
                    continue;
                }

                const selectedRunIds = new Set(this._manager.getSelectedRunIds());
                let selectedRunChanged = false;

                for (const change of changes) {
                    if (!change.metadata) {
                        continue;
                    }

                    this._manager.updateRun(change.metadata);
                    if (selectedRunIds.has(change.metadata.runId)) {
                        selectedRunChanged = true;
                    }
                }

                if (selectedRunChanged) {
                    await this._refreshRunDataInWebview();
                }
            }
        } catch (error) {
            console.error('Failed to process live run updates:', error);
        } finally {
            this._processingFileChanges = false;
        }
    }

    private async _refreshRunDataInWebview(): Promise<void> {
        await this._manager.parseSelectedRuns();
        await this._panel.webview.postMessage({
            command: 'runDataUpdated',
            mergedMetrics: this._manager.mergeMetrics()
        });
    }

    private async _rediscoverRuns(): Promise<number> {
        const knownRunIds = new Set(this._manager.getRuns().map(run => run.runId));
        await this._update(true);

        return this._manager.getRuns()
            .filter(run => !knownRunIds.has(run.runId))
            .length;
    }

    private async _update(scanForRuns: boolean = true): Promise<void> {
        const overallStart = Date.now();
        console.log('=== Multi-Run View Update Started ===');

        if (scanForRuns) {
            const t1 = Date.now();
            const discoveredRuns = await scanFolderForRuns(this._folderPath);
            const scanTime = Date.now() - t1;
            console.log(`[1] Folder scan: ${scanTime}ms (found ${discoveredRuns.length} runs)`);

            // Update manager with discovered runs
            const t2 = Date.now();
            const currentRuns = new Set(this._manager.getRuns().map(run => run.runId));
            const discoveredRunIds = new Set(discoveredRuns.map(run => run.runId));

            for (const run of discoveredRuns) {
                if (currentRuns.has(run.runId)) {
                    this._manager.updateRun(run);
                } else {
                    this._manager.addRun(run);
                }
            }

            for (const existingRun of this._manager.getRuns()) {
                if (!discoveredRunIds.has(existingRun.runId)) {
                    this._manager.removeRun(existingRun.runId);
                }
            }
            console.log(`[2] Run management: ${Date.now() - t2}ms`);
        } else {
            console.log('[1-2] Folder scan skipped');
        }

        const runs = this._manager.getRuns();

        // Parse selected runs and merge metrics
        const t3 = Date.now();
        await this._manager.parseSelectedRuns();
        console.log(`[3] Parsing runs: ${Date.now() - t3}ms (${this._manager.getSelectedRunIds().length} selected)`);

        const t4 = Date.now();
        const selectedRunIds = this._manager.getSelectedRunIds();
        const mergedMetrics = this._manager.mergeMetrics();
        console.log(`[4] Merge metrics: ${Date.now() - t4}ms (${mergedMetrics.training.length} training, ${mergedMetrics.system.length} system)`);

        // Load logo
        const t5 = Date.now();
        const logoPath = path.join(this._extensionUri.fsPath, 'media', 'bread_alpha.png');
        let logoBase64 = '';
        if (fs.existsSync(logoPath)) {
            logoBase64 = fs.readFileSync(logoPath).toString('base64');
        }
        console.log(`[5] Load logo: ${Date.now() - t5}ms`);

        const t6 = Date.now();
        const htmlContent = this._getHtmlContent(runs, selectedRunIds, mergedMetrics, logoBase64);
        console.log(`[6] Generate HTML: ${Date.now() - t6}ms (${Math.round(htmlContent.length / 1024)}KB)`);

        const t7 = Date.now();
        this._panel.webview.html = htmlContent;
        console.log(`[7] Set webview HTML: ${Date.now() - t7}ms`);

        console.log(`=== Total Update Time: ${Date.now() - overallStart}ms ===\n`);
    }

    private _getHtmlContent(
        runs: RunScanResult[],
        selectedRunIds: string[],
        mergedMetrics: { training: MergedMetric[], system: MergedMetric[] },
        logoBase64: string
    ): string {
        const selectedSet = new Set(selectedRunIds);
        const selectedRuns = runs.filter(run => selectedSet.has(run.runId));

        // Generate sidebar run list
        const runListHtml = runs.map(run => {
            const isSelected = selectedSet.has(run.runId);
            const color = this._manager.getRunColor(run.runId);
            return `
                <div class="run-item">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleRun('${run.runId}')">
                    <div class="run-color" style="background: ${color}"></div>
                    <div class="run-info">
                        <div class="run-name">${this._escapeHtml(run.runName)}</div>
                        <div class="run-meta">ID: ${this._escapeHtml(run.runId)}</div>
                    </div>
                </div>
            `;
        }).join('');

        // Generate metadata HTML
        const metadataHtml = selectedRuns.map(run => {
            const parsedData = this._manager.getParsedData(run.runId);
            const config = parsedData?.config || {};
            const configEntries = Object.entries(config);

            return `
                <div class="metadata-section">
                    <div class="metadata-header" onclick="toggleMetadata('${run.runId}')">
                        <span class="metadata-run-name">${this._escapeHtml(run.runName)}</span>
                        <span class="metadata-toggle">▼</span>
                    </div>
                    <div class="metadata-content">
                        ${configEntries.length > 0 ? `
                            <div class="config-grid">
                                ${configEntries.map(([key, value]) => `
                                    <div class="config-item">
                                        <span class="config-key">${this._escapeHtml(key)}:</span>
                                        <span class="config-value">${this._formatConfigValue(value)}</span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : '<div class="no-config">No configuration data</div>'}
                    </div>
                </div>
            `;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bread Wandb Viewer</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js"></script>
    <style>
        ${this._getPageStyles()}
        ${getChartStyles()}
    </style>
</head>
<body>
    <div class="container">
        <button class="expand-btn" id="expandBtn" onclick="toggleSidebar()">▶</button>
        <button class="collapse-btn" id="collapseBtn" onclick="toggleSidebar()">◀</button>

        <div class="sidebar" id="sidebar">
            <div class="resize-handle" id="resizeHandle"></div>

            <div class="sidebar-header">
                <h3>Runs (${runs.length})</h3>
                <div class="sidebar-controls">
                    <button class="btn-icon" onclick="selectAllRuns()" title="Select All">☑</button>
                    <button class="btn-icon" onclick="deselectAllRuns()" title="Deselect All">☐</button>
                    <button class="btn-icon rediscover-runs-btn" id="rediscoverRunsBtn" onclick="rediscoverRuns()" title="Search the opened directory for new runs">↻ Rediscover</button>
                </div>
            </div>

            <div class="sidebar-tabs">
                <button class="sidebar-tab active" data-sidebar-tab="runs" onclick="switchSidebarTab('runs')">Runs</button>
                <button class="sidebar-tab" data-sidebar-tab="metadata" onclick="switchSidebarTab('metadata')">Metadata</button>
            </div>

            <div class="sidebar-content active" id="runsContent">
                ${runListHtml}
            </div>

            <div class="sidebar-content" id="metadataContent">
                ${metadataHtml || '<div class="no-data">Select runs to view metadata</div>'}
            </div>
        </div>

        <div class="main-content">
            <div class="controls-bar-wrapper">
                ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" alt="Bread Logo" class="logo">` : ''}
                ${getControlsBarHtml(`
                    <div class="control-group">
                        <button class="toggle-btn reload-runs-btn" id="reloadRunsBtn" onclick="reloadSelectedRuns('reloadRunsBtn')" title="Reload data for selected runs" ${selectedRunIds.length === 0 ? 'disabled' : ''}>⟳ Reload runs</button>
                    </div>
                `)}
            </div>

            <div class="tabs">
                <button class="tab active" data-tab="training">Training Metrics</button>
                <button class="tab" data-tab="system">System Metrics</button>
            </div>

            <div id="training" class="tab-content active">
                ${this._generateMetricsHtml(mergedMetrics.training, 'training')}
            </div>

            <div id="system" class="tab-content">
                ${this._generateMetricsHtml(mergedMetrics.system, 'system')}
            </div>
        </div>
    </div>

    ${getModalHtml(`
        <button class="toggle-btn reload-runs-btn" id="modalReloadRunsBtn" onclick="reloadSelectedRuns('modalReloadRunsBtn')" title="Reload data for selected runs" ${selectedRunIds.length === 0 ? 'disabled' : ''}>⟳ Reload runs</button>
    `)}

    <script>
        ${getChartScript()}
        ${this._generateChartInitScript(mergedMetrics)}
    </script>
</body>
</html>`;
    }

    private _generateMetricsHtml(metrics: MergedMetric[], type: string): string {
        if (metrics.length === 0) {
            return '<div class="no-data">No metrics found</div>';
        }

        // Group metrics by their prefix (like single-run viewer)
        const groups = this._groupMetrics(metrics);

        return groups.map(group => `
            <div class="metric-group">
                <h3>${group.name}</h3>
                <div class="charts-grid">
                    ${group.metrics.map(metric => `
                        <div class="chart-container" data-chart-type="${type}" data-metric-name="${this._escapeHtml(metric.metricName)}">
                            <div class="chart-header">
                                <div class="chart-title">${this._escapeHtml(metric.metricName)}</div>
                                <div class="chart-actions">
                                    <button class="btn-small btn-copy-chart" onclick="copySingleChart('${type}', ${metric.index})" title="Copy chart to clipboard">📋</button>
                                    <button class="btn-small" onclick="openFullscreen(${metric.index}, '${type}')">⛶</button>
                                </div>
                            </div>
                            <div class="chart-wrapper">
                                <canvas id="chart-${type}-${metric.index}" data-chart-type="${type}" data-chart-index="${metric.index}" data-metric-name="${this._escapeHtml(metric.metricName)}"></canvas>
                            </div>
                            <div
                                class="chart-resize-handle"
                                role="separator"
                                aria-label="Resize ${this._escapeHtml(metric.metricName)} chart"
                                aria-orientation="horizontal"
                                aria-valuemin="160"
                                aria-valuemax="1200"
                                aria-valuenow="200"
                                tabindex="0"
                                title="Drag to resize chart height; use arrow keys when focused"
                            ></div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    }

    private _groupMetrics(metrics: MergedMetric[]): Array<{ name: string, metrics: Array<MergedMetric & { index: number }> }> {
        const groups: { [key: string]: Array<MergedMetric & { index: number }> } = {};

        metrics.forEach((metric, index) => {
            const groupName = this._extractGroupName(metric.metricName);
            if (!groups[groupName]) {
                groups[groupName] = [];
            }
            groups[groupName].push({ ...metric, index });
        });

        // Sort groups by priority
        const sortedGroupNames = Object.keys(groups).sort((a, b) => {
            const priority = ['loss', 'accuracy', 'lr', 'optim', 'perf', 'time', 'step'];
            const aIdx = priority.findIndex(p => a.toLowerCase().startsWith(p));
            const bIdx = priority.findIndex(p => b.toLowerCase().startsWith(p));

            if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
            if (aIdx !== -1) return -1;
            if (bIdx !== -1) return 1;

            const aIsGpu = a.toLowerCase().startsWith('gpu');
            const bIsGpu = b.toLowerCase().startsWith('gpu');
            if (aIsGpu && bIsGpu) return a.localeCompare(b);
            if (aIsGpu) return 1;
            if (bIsGpu) return 1;

            return a.localeCompare(b);
        });

        return sortedGroupNames.map(name => ({
            name,
            metrics: groups[name]
        }));
    }

    private _extractGroupName(key: string): string {
        if (key.includes('/')) {
            return key.split('/')[0];
        }

        if (key.includes('.')) {
            const parts = key.split('.');
            if (parts[0] === 'gpu' && parts.length >= 3) {
                return `gpu.${parts[1]}`;
            }
            return parts[0];
        }

        if (key.includes('_')) {
            const parts = key.split('_');
            const commonPrefixes = ['train', 'val', 'test', 'eval'];
            if (commonPrefixes.includes(parts[0])) {
                return parts[0];
            }
        }

        return key;
    }

    private _generateChartInitScript(mergedMetrics: { training: MergedMetric[], system: MergedMetric[] }): string {
        return `
            const vscode = acquireVsCodeApi();
            let trainingMetrics = ${JSON.stringify(mergedMetrics.training)};
            let systemMetrics = ${JSON.stringify(mergedMetrics.system)};
            let activeFullscreenMetric = null;
            const MIN_CHART_HEIGHT = 160;
            const MAX_CHART_HEIGHT = 1200;
            const DEFAULT_CHART_HEIGHT = 200;
            const persistedViewState = vscode.getState() || {};
            const savedChartHeights = persistedViewState.chartHeights &&
                typeof persistedViewState.chartHeights === 'object'
                ? persistedViewState.chartHeights
                : {};

            // Sidebar resizing
            let isResizing = false;
            const resizeHandle = document.getElementById('resizeHandle');
            const sidebar = document.getElementById('sidebar');
            const collapseBtn = document.getElementById('collapseBtn');

            function updateCollapseButtonPosition() {
                const sidebarWidth = sidebar.getBoundingClientRect().width;
                if (sidebarWidth > 0) {
                    collapseBtn.style.left = (sidebarWidth - 10) + 'px';
                }
            }

            resizeHandle.addEventListener('mousedown', (e) => {
                isResizing = true;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
            });

            document.addEventListener('mousemove', (e) => {
                if (!isResizing) return;
                const newWidth = e.clientX;
                if (newWidth >= 200 && newWidth <= 600) {
                    sidebar.style.flex = '0 0 ' + newWidth + 'px';
                    updateCollapseButtonPosition();
                }
            });

            document.addEventListener('mouseup', () => {
                if (isResizing) {
                    isResizing = false;
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                }
            });

            // Initialize button position
            updateCollapseButtonPosition();

            // Per-chart height resizing
            function getChartResizeKey(container) {
                return container.dataset.chartType + ':' + container.dataset.metricName;
            }

            function clampChartHeight(height) {
                return Math.min(MAX_CHART_HEIGHT, Math.max(MIN_CHART_HEIGHT, height));
            }

            function resizeChartContainer(container, height) {
                const clampedHeight = Math.round(clampChartHeight(height));
                const wrapper = container.querySelector('.chart-wrapper');
                const handle = container.querySelector('.chart-resize-handle');
                if (!wrapper || !handle) return;

                wrapper.style.height = clampedHeight + 'px';
                handle.setAttribute('aria-valuenow', String(clampedHeight));

                const canvas = wrapper.querySelector('canvas');
                const chart = canvas ? chartInstances[canvas.id] : null;
                if (chart) {
                    chart.resize();
                }
            }

            function saveChartHeight(container) {
                const wrapper = container.querySelector('.chart-wrapper');
                if (!wrapper) return;

                savedChartHeights[getChartResizeKey(container)] = Math.round(
                    wrapper.getBoundingClientRect().height
                );
                vscode.setState({
                    ...persistedViewState,
                    chartHeights: savedChartHeights
                });
            }

            document.querySelectorAll('.chart-container').forEach(container => {
                const savedHeight = Number(savedChartHeights[getChartResizeKey(container)]);
                if (Number.isFinite(savedHeight)) {
                    resizeChartContainer(container, savedHeight);
                }

                const handle = container.querySelector('.chart-resize-handle');
                if (!handle) return;

                handle.addEventListener('pointerdown', event => {
                    if (event.button !== 0) return;

                    const wrapper = container.querySelector('.chart-wrapper');
                    if (!wrapper) return;

                    const startY = event.clientY;
                    const startHeight = wrapper.getBoundingClientRect().height;
                    handle.setPointerCapture(event.pointerId);
                    handle.classList.add('active');
                    document.body.classList.add('chart-resizing');

                    const onPointerMove = moveEvent => {
                        resizeChartContainer(
                            container,
                            startHeight + moveEvent.clientY - startY
                        );
                    };

                    const finishResize = finishEvent => {
                        handle.removeEventListener('pointermove', onPointerMove);
                        handle.removeEventListener('pointerup', finishResize);
                        handle.removeEventListener('pointercancel', finishResize);
                        if (handle.hasPointerCapture(finishEvent.pointerId)) {
                            handle.releasePointerCapture(finishEvent.pointerId);
                        }
                        handle.classList.remove('active');
                        document.body.classList.remove('chart-resizing');
                        saveChartHeight(container);
                    };

                    handle.addEventListener('pointermove', onPointerMove);
                    handle.addEventListener('pointerup', finishResize);
                    handle.addEventListener('pointercancel', finishResize);
                    event.preventDefault();
                });

                handle.addEventListener('keydown', event => {
                    if (
                        event.key !== 'ArrowUp' &&
                        event.key !== 'ArrowDown' &&
                        event.key !== 'Home'
                    ) {
                        return;
                    }

                    const wrapper = container.querySelector('.chart-wrapper');
                    if (!wrapper) return;

                    if (event.key === 'Home') {
                        resizeChartContainer(container, DEFAULT_CHART_HEIGHT);
                    } else {
                        const direction = event.key === 'ArrowDown' ? 1 : -1;
                        const step = event.shiftKey ? 50 : 20;
                        resizeChartContainer(
                            container,
                            wrapper.getBoundingClientRect().height + direction * step
                        );
                    }
                    saveChartHeight(container);
                    event.preventDefault();
                });
            });

            // Sidebar collapse/expand
            function toggleSidebar() {
                sidebar.classList.toggle('collapsed');
                const collapseBtn = document.getElementById('collapseBtn');
                const expandBtn = document.getElementById('expandBtn');
                const isCollapsed = sidebar.classList.contains('collapsed');

                if (isCollapsed) {
                    collapseBtn.style.display = 'none';
                    expandBtn.style.display = 'block';
                } else {
                    collapseBtn.style.display = 'block';
                    expandBtn.style.display = 'none';
                }
            }

            // Sidebar tab switching
            function switchSidebarTab(tab) {
                const tabs = document.querySelectorAll('.sidebar-tab');
                const contents = document.querySelectorAll('.sidebar-content');

                tabs.forEach(t => t.classList.remove('active'));
                contents.forEach(c => c.classList.remove('active'));

                document.querySelector('[data-sidebar-tab="' + tab + '"]').classList.add('active');
                document.getElementById(tab + 'Content').classList.add('active');
            }

            // Metadata toggling
            function toggleMetadata(runId) {
                const header = document.querySelector("[onclick=\\"toggleMetadata('" + runId + "')\\"");
                const section = header.parentElement;
                section.classList.toggle('collapsed');
            }

            // Run selection
            function toggleRun(runId) {
                vscode.postMessage({ command: 'toggleRun', runId });
            }

            function selectAllRuns() {
                vscode.postMessage({ command: 'selectAll' });
            }

            function deselectAllRuns() {
                vscode.postMessage({ command: 'deselectAll' });
            }

            function reloadSelectedRuns(buttonId) {
                const button = document.getElementById(buttonId);
                if (!button || button.disabled) return;

                button.disabled = true;
                button.textContent = '⟳ Reloading…';
                button.setAttribute('aria-busy', 'true');
                vscode.postMessage({ command: 'reloadSelectedRuns' });
            }

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command !== 'reloadSelectedRunsComplete') return;

                ['reloadRunsBtn', 'modalReloadRunsBtn'].forEach(buttonId => {
                    const button = document.getElementById(buttonId);
                    if (!button) return;

                    button.textContent = '⟳ Reload runs';
                    button.disabled = !message.canReload;
                    button.removeAttribute('aria-busy');
                });

            });

            function rediscoverRuns() {
                const button = document.getElementById('rediscoverRunsBtn');
                if (!button || button.disabled) return;

                button.disabled = true;
                button.textContent = '↻ Discovering…';
                button.setAttribute('aria-busy', 'true');
                vscode.postMessage({ command: 'rediscoverRuns' });
            }

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command !== 'rediscoverRunsComplete') return;

                const button = document.getElementById('rediscoverRunsBtn');
                if (!button) return;

                button.textContent = '↻ Rediscover';
                button.disabled = false;
                button.removeAttribute('aria-busy');
            });

            function createRunDatasets(metric, isModal) {
                return metric.datasets.map(dataset => ({
                    label: dataset.runName,
                    data: dataset.data.map(d => ({ x: d.step, y: d.value })),
                    borderColor: dataset.color,
                    backgroundColor: dataset.color + '20',
                    fill: true,
                    tension: 0.1,
                    pointRadius: dataset.data.length > (isModal ? 100 : 50) ? 0 : (isModal ? 3 : 2),
                    pointHoverRadius: isModal ? 5 : 4,
                    borderWidth: 2,
                    _originalData: dataset.data.map(d => ({ x: d.step, y: d.value })),
                    _originalColor: dataset.color,
                    _runName: dataset.runName,
                    _runId: dataset.runId,
                    _isOriginal: true
                }));
            }

            function updateChartData(chart, metric, isModal) {
                if (!chart) return;

                if (!metric) {
                    chart.data.datasets = [];
                    chart.update('none');
                    return;
                }

                const datasets = createRunDatasets(metric, isModal);
                const maxPoints = Math.max(
                    ...datasets.map(dataset => dataset.data.length),
                    0
                );
                chart.options.plugins.decimation.enabled = maxPoints > 500;
                chart.data.datasets = datasets;

                const smoothing = isModal
                    ? parseFloat(document.getElementById('modalSmoothing').value)
                    : globalSmoothing;
                updateChartSmoothing(chart, smoothing, isModal ? modalShowRaw : showRaw);
            }

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command !== 'runDataUpdated' || !message.mergedMetrics) {
                    return;
                }

                trainingMetrics = message.mergedMetrics.training || [];
                systemMetrics = message.mergedMetrics.system || [];

                Object.entries(chartInstances).forEach(([canvasId, chart]) => {
                    const canvas = document.getElementById(canvasId);
                    if (!canvas) return;

                    const metrics = canvas.dataset.chartType === 'training'
                        ? trainingMetrics
                        : systemMetrics;
                    const metric = metrics.find(
                        candidate => candidate.metricName === canvas.dataset.metricName
                    );
                    updateChartData(chart, metric, false);
                });

                if (modalChart && activeFullscreenMetric) {
                    const metrics = activeFullscreenMetric.type === 'training'
                        ? trainingMetrics
                        : systemMetrics;
                    const metric = metrics.find(
                        candidate => candidate.metricName === activeFullscreenMetric.metricName
                    );
                    updateChartData(modalChart, metric, true);
                }
            });

            // Fullscreen modal
            function openFullscreen(metricIndex, type) {
                const metrics = type === 'training' ? trainingMetrics : systemMetrics;
                const metric = metrics[metricIndex];
                if (!metric) return;

                activeFullscreenMetric = {
                    metricName: metric.metricName,
                    type
                };

                document.getElementById('modalTitle').textContent = metric.metricName;
                document.getElementById('fullscreenModal').classList.add('active');
                document.body.classList.add('modal-open');

                document.getElementById('modalSmoothing').value = 0;
                document.getElementById('modalSmoothingValue').textContent = '0.00';
                document.getElementById('modalShowRawGroup').style.display = 'none';
                modalShowRaw = showRaw;
                document.getElementById('modalShowRawBtn').classList.toggle('active', modalShowRaw);
                modalLogX = false;
                modalLogY = false;
                document.getElementById('modalLogXBtn').classList.remove('active');
                document.getElementById('modalLogYBtn').classList.remove('active');

                if (modalChart) modalChart.destroy();

                const ctx = document.getElementById('modalChart');
                const datasets = createRunDatasets(metric, true);

                modalChart = createUnifiedChart(ctx, datasets, metric.metricName, {
                    isModal: true,
                    enableZoom: true
                });
            }

            // Lazy chart initialization using IntersectionObserver
            // Only creates charts when they become visible (huge performance win for 50+ charts)
            const chartObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const canvas = entry.target;
                        const canvasId = canvas.id;

                        // Check if chart already exists
                        if (chartInstances[canvasId]) return;

                        // Defer chart creation to next frame to avoid blocking render
                        requestAnimationFrame(() => {
                            // Get metric data from dataset attributes
                            const type = canvas.dataset.chartType;
                            const index = parseInt(canvas.dataset.chartIndex);
                            const metrics = type === 'training' ? trainingMetrics : systemMetrics;
                            const metric = metrics[index];

                            if (!metric) return;

                            // Create chart datasets
                            const datasets = createRunDatasets(metric, false);

                            // Create the chart
                            chartInstances[canvasId] = createUnifiedChart(canvas, datasets, metric.metricName, {
                                isModal: false,
                                enableZoom: true
                            });

                            // Apply current global smoothing to newly created chart
                            updateChartSmoothing(chartInstances[canvasId], globalSmoothing, showRaw);

                            // Stop observing this chart
                            chartObserver.unobserve(canvas);
                        });
                    }
                });
            }, {
                rootMargin: '100px' // Start loading charts 100px before they enter viewport (conservative)
            });

            // Defer observer setup to next frame so UI renders immediately
            requestAnimationFrame(() => {
                // Observe all chart canvases for lazy loading
                document.querySelectorAll('canvas[id^="chart-"]').forEach(canvas => {
                    chartObserver.observe(canvas);
                });

                console.log('Lazy chart rendering initialized for ' + (trainingMetrics.length + systemMetrics.length) + ' charts');
            });

        `;
    }

    private _getPageStyles(): string {
        return `
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: var(--vscode-font-family);
                color: var(--vscode-foreground);
                background: var(--vscode-editor-background);
                height: 100vh;
                overflow: hidden;
            }
            .container {
                display: flex;
                height: 100vh;
                position: relative;
                overflow: hidden;
            }

            /* Sidebar */
            .sidebar {
                flex: 0 0 280px;
                background: var(--vscode-sideBar-background);
                border-right: 1px solid var(--vscode-panel-border);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                position: relative;
            }
            .sidebar.collapsed {
                flex: 0 0 0 !important;
                min-width: 0;
            }
            .resize-handle {
                position: absolute;
                right: 0;
                top: 0;
                bottom: 0;
                width: 4px;
                cursor: col-resize;
                background: transparent;
            }
            .resize-handle:hover {
                background: var(--vscode-focusBorder);
            }
            .sidebar-header {
                padding: 15px;
                border-bottom: 1px solid var(--vscode-panel-border);
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .sidebar-header h3 {
                font-size: 1em;
                font-weight: 600;
                margin: 0;
            }
            .controls-bar-wrapper {
                display: flex;
                align-items: center;
                gap: 8px;
                padding-left: 15px;
            }
            .controls-bar-wrapper .logo {
                width: 28px;
                height: 28px;
                object-fit: contain;
                flex-shrink: 0;
            }
            .sidebar-controls {
                display: flex;
                gap: 5px;
            }
            .btn-icon {
                background: transparent;
                border: 1px solid var(--vscode-button-border);
                color: var(--vscode-button-foreground);
                padding: 4px 8px;
                cursor: pointer;
                border-radius: 3px;
                font-size: 0.9em;
            }
            .btn-icon:hover {
                background: var(--vscode-button-hoverBackground);
            }
            .btn-icon:disabled,
            .reload-runs-btn:disabled {
                cursor: wait;
                opacity: 0.65;
            }
            .reload-runs-btn,
            .rediscover-runs-btn {
                white-space: nowrap;
            }
            .sidebar-tabs {
                display: flex;
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            .sidebar-tab {
                flex: 1;
                padding: 8px;
                text-align: center;
                cursor: pointer;
                background: transparent;
                border: none;
                color: var(--vscode-tab-inactiveForeground);
                border-bottom: 2px solid transparent;
                font-size: 0.85em;
            }
            .sidebar-tab:hover {
                color: var(--vscode-tab-activeForeground);
            }
            .sidebar-tab.active {
                color: var(--vscode-tab-activeForeground);
                border-bottom-color: var(--vscode-tab-activeBorder);
            }
            .sidebar-content {
                flex: 1;
                overflow-y: auto;
                padding: 10px;
                display: none;
            }
            .sidebar-content.active {
                display: block;
            }
            .run-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px;
                margin-bottom: 4px;
                border-radius: 4px;
                cursor: pointer;
            }
            .run-item:hover {
                background: var(--vscode-list-hoverBackground);
            }
            .run-item input[type="checkbox"] {
                width: 16px;
                height: 16px;
                cursor: pointer;
                accent-color: var(--vscode-checkbox-background);
            }
            .run-color {
                width: 12px;
                height: 12px;
                border-radius: 2px;
            }
            .run-info {
                flex: 1;
                min-width: 0;
            }
            .run-name {
                font-size: 0.85em;
                font-weight: 500;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .run-meta {
                font-size: 0.7em;
                color: var(--vscode-descriptionForeground);
            }
            .metadata-section {
                margin-bottom: 8px;
                border-radius: 4px;
                background: var(--vscode-editor-inactiveSelectionBackground);
            }
            .metadata-header {
                padding: 10px;
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                font-size: 0.85em;
            }
            .metadata-header:hover {
                background: var(--vscode-list-hoverBackground);
            }
            .metadata-run-name {
                font-weight: 600;
            }
            .metadata-toggle {
                transition: transform 0.2s;
            }
            .metadata-section.collapsed .metadata-toggle {
                transform: rotate(-90deg);
            }
            .metadata-content {
                max-height: 300px;
                overflow-y: auto;
                border-top: 1px solid var(--vscode-panel-border);
            }
            .metadata-section.collapsed .metadata-content {
                display: none;
            }
            .config-grid {
                padding: 10px;
            }
            .config-item {
                padding: 4px 0;
                font-size: 0.8em;
            }
            .config-key {
                color: var(--vscode-symbolIcon-variableForeground);
                font-weight: 600;
            }
            .config-value {
                color: var(--vscode-foreground);
                margin-left: 8px;
            }
            .config-value pre {
                background: var(--vscode-textCodeBlock-background);
                padding: 8px;
                border-radius: 3px;
                border: 1px solid var(--vscode-panel-border);
                overflow-x: auto;
            }
            .no-config, .no-data {
                padding: 15px;
                text-align: center;
                color: var(--vscode-descriptionForeground);
                font-size: 0.8em;
            }

            /* Collapse buttons */
            .collapse-btn, .expand-btn {
                position: fixed;
                top: 50%;
                transform: translateY(-50%);
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 8px 6px;
                cursor: pointer;
                z-index: 100;
                border-radius: 3px;
                font-size: 12px;
            }
            .collapse-btn {
                left: 270px;
            }
            .expand-btn {
                left: 10px;
                display: none;
            }

            /* Main content */
            .main-content {
                flex: 1;
                overflow-y: auto;
                padding: 20px;
            }
            .metric-group {
                margin-bottom: 30px;
            }
            .metric-group h3 {
                font-size: 1.1em;
                font-weight: 600;
                margin-bottom: 15px;
                color: var(--vscode-foreground);
            }
            .tabs {
                display: flex;
                gap: 10px;
                margin-bottom: 20px;
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            .tab {
                background: transparent;
                border: none;
                border-bottom: 2px solid transparent;
                color: var(--vscode-tab-inactiveForeground);
                padding: 10px 20px;
                cursor: pointer;
                font-size: 0.9em;
            }
            .tab:hover {
                color: var(--vscode-tab-activeForeground);
            }
            .tab.active {
                color: var(--vscode-tab-activeForeground);
                border-bottom-color: var(--vscode-tab-activeBorder);
            }
            .tab-content {
                display: none;
            }
            .tab-content.active {
                display: block;
            }
            .chart-resize-handle {
                position: relative;
                height: 16px;
                margin: 6px -8px -10px;
                border-top: 1px solid var(--vscode-panel-border, #555);
                cursor: row-resize;
                touch-action: none;
                transition: border-color 0.15s, background-color 0.15s;
            }
            .chart-resize-handle::after {
                content: '';
                position: absolute;
                top: 4px;
                left: 50%;
                width: 48px;
                height: 4px;
                border-radius: 2px;
                background: var(--vscode-descriptionForeground, #999);
                opacity: 0.85;
                transform: translateX(-50%);
                transition: background-color 0.15s, opacity 0.15s;
            }
            .chart-resize-handle:hover,
            .chart-resize-handle:focus-visible,
            .chart-resize-handle.active {
                border-top-color: var(--vscode-focusBorder, #007acc);
                background: var(--vscode-list-hoverBackground);
                outline: none;
            }
            .chart-resize-handle:hover::after,
            .chart-resize-handle:focus-visible::after,
            .chart-resize-handle.active::after {
                background: var(--vscode-focusBorder, #007acc);
                opacity: 1;
            }
            body.chart-resizing {
                cursor: row-resize;
                user-select: none;
            }
        `;
    }

    private _escapeHtml(text: string): string {
        return text.replace(/[&<>"']/g, (char) => {
            const entities: { [key: string]: string } = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            };
            return entities[char] || char;
        });
    }

    private _formatConfigValue(value: any): string {
        if (value === null || value === undefined) {
            return '<span style="color: var(--vscode-descriptionForeground);">null</span>';
        }
        
        if (typeof value === 'string') {
            return this._escapeHtml(value);
        }
        
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        
        if (typeof value === 'object') {
            // Format objects and arrays with indentation
            const json = JSON.stringify(value, null, 2);
            return `<pre style="margin: 4px 0; font-family: var(--vscode-editor-font-family); font-size: 0.9em; white-space: pre-wrap; word-break: break-all;">${this._escapeHtml(json)}</pre>`;
        }
        
        return this._escapeHtml(String(value));
    }

    private async _handleGenerateAIContext(action: string) {
        // Get selected runs
        const selectedRuns = this._manager.getRuns()
            .filter(r => this._manager.isRunSelected(r.runId));

        if (selectedRuns.length === 0) {
            vscode.window.showWarningMessage('Please select at least one run to generate AI context.');
            return;
        }

        // Generate the AI context
        try {
            const context = generateAIContext(
                selectedRuns,
                this._manager.getState().parsedData,
                this._folderPath
            );
            const tokens = calculateTokenEstimate(context);

            if (action === 'copy') {
                // Copy to clipboard
                await vscode.env.clipboard.writeText(context);

                vscode.window.showInformationMessage(
                    `Context copied to clipboard (${tokens} tokens)`
                );
            } else if (action === 'save') {
                // Save to file
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(this._folderPath, 'wandb-context.md')),
                    filters: {
                        'Markdown': ['md'],
                        'MCD': ['mdc'],
                        'All Files': ['*']
                    }
                });

                if (uri) {
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(context, 'utf8'));

                    vscode.window.showInformationMessage(
                        `Context saved to ${path.basename(uri.fsPath)} (${tokens} tokens)`
                    );
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to generate AI context: ${error instanceof Error ? error.message : String(error)}`
            );
            console.error('Error generating AI context:', error);
        }
    }

    private async _handleSaveChartImage(imageBase64: string, chartCount: number) {
        try {
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(this._folderPath, 'wandb-charts.png')),
                filters: {
                    'PNG Image': ['png']
                }
            });

            if (uri) {
                const buffer = Buffer.from(imageBase64, 'base64');
                await vscode.workspace.fs.writeFile(uri, buffer);

                vscode.window.showInformationMessage(
                    `Chart image saved to ${path.basename(uri.fsPath)} (${chartCount} charts)`
                );
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to save chart image: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private async _handleCopyChartImageFallback(imageBase64: string) {
        try {
            const os = require('os');
            const tmpPath = path.join(os.tmpdir(), `wandb-charts-${Date.now()}.png`);
            const buffer = Buffer.from(imageBase64, 'base64');
            fs.writeFileSync(tmpPath, buffer);

            const selection = await vscode.window.showInformationMessage(
                `Chart image saved to temporary file.`,
                'Open File'
            );
            if (selection === 'Open File') {
                await vscode.env.openExternal(vscode.Uri.file(tmpPath));
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                'Failed to save chart image. Please use "Save as PNG" instead.'
            );
        }
    }

    private _getLoadingHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loading...</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
        }
        .loading-container {
            text-align: center;
        }
        .spinner {
            width: 48px;
            height: 48px;
            border: 4px solid var(--vscode-progressBar-background, #333);
            border-top-color: var(--vscode-progressBar-background, #007acc);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .loading-text {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="loading-container">
        <div class="spinner"></div>
        <div class="loading-text">Loading W&B runs...</div>
    </div>
</body>
</html>`;
    }

    public dispose() {
        this._disposed = true;
        MultiRunViewerPanel.currentPanel = undefined;
        this._panel.dispose();
        if (this._folderWatcher) {
            this._folderWatcher.dispose();
        }
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
