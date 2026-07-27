"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const wandbParser_1 = require("./wandbParser");
const webviewPanel_1 = require("./webviewPanel");
const MultiRunViewerPanel_1 = require("./MultiRunViewerPanel");
const chartTemplate_1 = require("./chartTemplate");
function activate(context) {
    console.log('W&B Viewer extension activated');
    // Register custom editor for .wandb files
    context.subscriptions.push(WandbEditorProvider.register(context));
    // Also keep the command for right-click on folders
    const viewRunCommand = vscode.commands.registerCommand('wandb-viewer.viewRun', async (uri) => {
        let folderPath;
        if (uri) {
            folderPath = uri.fsPath;
        }
        else {
            const selected = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                title: 'Select W&B Run Directory'
            });
            if (!selected || selected.length === 0) {
                return;
            }
            folderPath = selected[0].fsPath;
        }
        if (!(0, wandbParser_1.isWandbRunDirectory)(folderPath)) {
            vscode.window.showErrorMessage('This folder does not contain a W&B run (.wandb file not found)');
            return;
        }
        const runFiles = (0, wandbParser_1.getRunFiles)(folderPath);
        if (!runFiles.wandbFile) {
            vscode.window.showErrorMessage('Could not find .wandb file');
            return;
        }
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Loading W&B run...',
                cancellable: false
            }, async () => {
                const runData = (0, wandbParser_1.parseWandbFile)(runFiles.wandbFile);
                const logMetrics = runFiles.outputLog
                    ? (0, wandbParser_1.parseOutputLog)(runFiles.outputLog)
                    : {};
                webviewPanel_1.WandbViewerPanel.createOrShow(context.extensionUri, runData, logMetrics, folderPath, runFiles.outputLog);
            });
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to parse W&B run: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
    context.subscriptions.push(viewRunCommand);
    // Register multi-run comparison command
    const compareRunsCommand = vscode.commands.registerCommand('wandb-viewer.compareRuns', async (uri) => {
        let folderPath;
        if (uri) {
            folderPath = uri.fsPath;
        }
        else {
            const selected = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                title: 'Select Folder with W&B Runs'
            });
            if (!selected || selected.length === 0) {
                return;
            }
            folderPath = selected[0].fsPath;
        }
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Scanning for W&B runs...',
                cancellable: false
            }, async () => {
                await MultiRunViewerPanel_1.MultiRunViewerPanel.createOrShow(context.extensionUri, folderPath);
            });
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to load multi-run viewer: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
    context.subscriptions.push(compareRunsCommand);
}
/**
 * Custom editor provider for .wandb files
 */
class WandbEditorProvider {
    constructor(context) {
        this.context = context;
    }
    static register(context) {
        const provider = new WandbEditorProvider(context);
        return vscode.window.registerCustomEditorProvider(WandbEditorProvider.viewType, provider, {
            webviewOptions: {
                retainContextWhenHidden: true
            },
            supportsMultipleEditorsPerDocument: false
        });
    }
    async openCustomDocument(uri, _openContext, _token) {
        return { uri, dispose: () => { } };
    }
    async resolveCustomEditor(document, webviewPanel, _token) {
        const wandbFilePath = document.uri.fsPath;
        const runDir = path.dirname(wandbFilePath);
        // File watcher for live updates
        let fileWatcher = null;
        let debounceTimer = null;
        const DEBOUNCE_MS = 1000; // Wait 1 second after last change before updating
        // Find the logo - first check extension's media folder
        let logoBase64 = '';
        const extensionMediaPath = path.join(this.context.extensionPath, 'media', 'bread_alpha.png');
        if (fs.existsSync(extensionMediaPath)) {
            const logoData = fs.readFileSync(extensionMediaPath);
            logoBase64 = logoData.toString('base64');
        }
        // Fallback: check workspace folders
        if (!logoBase64) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
                for (const folder of workspaceFolders) {
                    const logoPath = path.join(folder.uri.fsPath, 'bread_alpha.png');
                    if (fs.existsSync(logoPath)) {
                        const logoData = fs.readFileSync(logoPath);
                        logoBase64 = logoData.toString('base64');
                        break;
                    }
                }
            }
        }
        // Fallback: check parent directories of the wandb file
        if (!logoBase64) {
            let searchDir = runDir;
            for (let i = 0; i < 5; i++) {
                const logoPath = path.join(searchDir, 'bread_alpha.png');
                if (fs.existsSync(logoPath)) {
                    const logoData = fs.readFileSync(logoPath);
                    logoBase64 = logoData.toString('base64');
                    break;
                }
                searchDir = path.dirname(searchDir);
            }
        }
        webviewPanel.webview.options = {
            enableScripts: true
        };
        try {
            const runData = (0, wandbParser_1.parseWandbFile)(wandbFilePath);
            const runFiles = (0, wandbParser_1.getRunFiles)(runDir);
            const logMetrics = runFiles.outputLog
                ? (0, wandbParser_1.parseOutputLog)(runFiles.outputLog)
                : {};
            webviewPanel.webview.html = this.getHtmlContent(webviewPanel.webview, runData, logMetrics, runDir, runFiles.outputLog, logoBase64);
            webviewPanel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'openOutputLog':
                        if (runFiles.outputLog) {
                            const doc = await vscode.workspace.openTextDocument(runFiles.outputLog);
                            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                        }
                        else {
                            vscode.window.showWarningMessage('Output log not found');
                        }
                        break;
                    case 'openFile':
                        const filePath = path.join(runDir, message.file);
                        const fileDoc = await vscode.workspace.openTextDocument(filePath);
                        await vscode.window.showTextDocument(fileDoc, vscode.ViewColumn.Beside);
                        break;
                }
            });
            // Set up file watcher for live updates
            const refreshData = () => {
                try {
                    console.log('[W&B Viewer] File changed, re-parsing...');
                    const newRunData = (0, wandbParser_1.parseWandbFile)(wandbFilePath);
                    const newLogMetrics = runFiles.outputLog
                        ? (0, wandbParser_1.parseOutputLog)(runFiles.outputLog)
                        : {};
                    // Merge metrics
                    const allMetrics = { ...newRunData.metrics };
                    for (const [key, values] of Object.entries(newLogMetrics)) {
                        if (!allMetrics[key] || allMetrics[key].length === 0) {
                            allMetrics[key] = values;
                        }
                    }
                    // Send updated data to webview
                    webviewPanel.webview.postMessage({
                        command: 'updateData',
                        trainingMetrics: allMetrics,
                        systemMetrics: newRunData.systemMetrics
                    });
                }
                catch (error) {
                    console.error('[W&B Viewer] Error refreshing data:', error);
                }
            };
            // Watch for file changes
            try {
                fileWatcher = fs.watch(wandbFilePath, (eventType) => {
                    if (eventType === 'change') {
                        // Debounce to avoid rapid updates
                        if (debounceTimer) {
                            clearTimeout(debounceTimer);
                        }
                        debounceTimer = setTimeout(refreshData, DEBOUNCE_MS);
                    }
                });
            }
            catch (error) {
                console.error('Could not set up file watcher:', error);
            }
            // Cleanup watcher when panel is disposed
            webviewPanel.onDidDispose(() => {
                if (fileWatcher) {
                    fileWatcher.close();
                    fileWatcher = null;
                }
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                    debounceTimer = null;
                }
            });
        }
        catch (error) {
            webviewPanel.webview.html = `
                <html>
                <body style="padding: 20px; font-family: sans-serif; color: #d4d4d4; background: #1e1e1e;">
                    <h2>Error loading W&B run</h2>
                    <p>${error instanceof Error ? error.message : String(error)}</p>
                </body>
                </html>
            `;
        }
    }
    generateHeaderHtml(logoBase64, projectName, runName, runId, outputLogPath) {
        return `
            <div class="header">
                <div class="header-left">
                    ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" alt="Logo" class="logo">` : ''}
                    <div class="title-section">
                        <div class="project-name">${projectName}</div>
                        <h1>${runName}</h1>
                        <div class="run-id">ID: ${runId}</div>
                    </div>
                </div>
                <button class="btn" onclick="openOutputLog()" ${!outputLogPath ? 'disabled' : ''}>
                    View Output Log
                </button>
            </div>
        `;
    }
    generateMetadataHtml(metadata) {
        if (!metadata.gpu && !metadata.python)
            return '';
        return `
            <div class="metadata">
                <h3>Run Information</h3>
                <div class="metadata-grid">
                    ${metadata.gpu ? `<div class="metadata-item"><span class="metadata-label">GPU:</span> ${metadata.gpu}</div>` : ''}
                    ${metadata.gpu_count ? `<div class="metadata-item"><span class="metadata-label">GPU Count:</span> ${metadata.gpu_count}</div>` : ''}
                    ${metadata.python ? `<div class="metadata-item"><span class="metadata-label">Python:</span> ${metadata.python}</div>` : ''}
                    ${metadata.host ? `<div class="metadata-item"><span class="metadata-label">Host:</span> ${metadata.host}</div>` : ''}
                    ${metadata.startedAt ? `<div class="metadata-item"><span class="metadata-label">Started:</span> ${new Date(metadata.startedAt).toLocaleString()}</div>` : ''}
                </div>
            </div>
        `;
    }
    generatePageStyles() {
        return `
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                padding: 20px;
                background: var(--vscode-editor-background, #1e1e1e);
                color: var(--vscode-editor-foreground, #d4d4d4);
                margin: 0;
            }
            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                flex-wrap: wrap;
                gap: 15px;
            }
            .header-left { display: flex; align-items: center; gap: 15px; }
            .logo { width: 32px; height: 32px; object-fit: contain; opacity: 0.85; }
            .title-section { display: flex; flex-direction: column; gap: 4px; }
            .project-name { font-size: 0.85em; color: var(--vscode-descriptionForeground, #888); line-height: 1.4; }
            h1 { margin: 0; font-size: 1.4em; color: var(--vscode-foreground, #fff); line-height: 1.3; }
            .run-id { font-size: 0.75em; color: var(--vscode-descriptionForeground, #666); font-family: monospace; line-height: 1.4; margin-top: 2px; }
            .btn { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 14px; }
            .btn:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
            .btn:disabled { opacity: 0.5; cursor: not-allowed; }
            .metadata { background: var(--vscode-editor-inactiveSelectionBackground, #3a3d41); padding: 15px; border-radius: 8px; margin-bottom: 20px; }
            .metadata h3 { margin: 0 0 10px 0; font-size: 1em; }
            .metadata-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
            .metadata-item { font-size: 0.85em; }
            .metadata-label { color: var(--vscode-descriptionForeground, #888); }
            .config-item { background: var(--vscode-editor-inactiveSelectionBackground, #252526); padding: 10px 15px; margin-bottom: 8px; border-radius: 4px; }
            .config-key { font-weight: bold; color: var(--vscode-symbolIcon-variableForeground, #75beff); }
            .config-value { font-family: monospace; font-size: 0.85em; margin-top: 5px; word-break: break-all; white-space: pre-wrap; max-height: 200px; overflow-y: auto; }
        `;
    }
    generateChartInitScript(allMetrics, systemMetrics) {
        return `
            const vscode = acquireVsCodeApi();
            const trainingMetrics = ${JSON.stringify(allMetrics)};
            const systemMetrics = ${JSON.stringify(systemMetrics)};
            const colors = CHART_COLORS;

            function openOutputLog() {
                vscode.postMessage({ command: 'openOutputLog' });
            }

            function openFullscreen(metricKey, dataType) {
                const data = dataType === 'training' ? trainingMetrics[metricKey] : systemMetrics[metricKey];
                if (!data) return;

                document.getElementById('modalTitle').textContent = metricKey;
                document.getElementById('fullscreenModal').classList.add('active');
                document.body.classList.add('modal-open');

                document.getElementById('modalSmoothing').value = 0;
                document.getElementById('modalSmoothingValue').textContent = '0.00';
                modalLogX = false;
                modalLogY = false;
                document.getElementById('modalLogXBtn').classList.remove('active');
                document.getElementById('modalLogYBtn').classList.remove('active');

                if (modalChart) modalChart.destroy();

                const ctx = document.getElementById('modalChart');
                const colorIndex = Object.keys(dataType === 'training' ? trainingMetrics : systemMetrics).indexOf(metricKey);

                const chartData = data.map(d => ({ x: d.step, y: d.value }));

                const datasets = [{
                    label: metricKey,
                    data: chartData,
                    borderColor: colors[colorIndex % colors.length],
                    backgroundColor: colors[colorIndex % colors.length] + '20',
                    fill: true,
                    tension: 0.1,
                    pointRadius: data.length > 100 ? 0 : 3,
                    pointHoverRadius: 5,
                    borderWidth: 2,
                    _originalData: chartData,
                    _originalColor: colors[colorIndex % colors.length],
                    _runName: metricKey,
                    _isOriginal: true
                }];

                modalChart = createUnifiedChart(ctx, datasets, metricKey, { isModal: true, enableZoom: true });
            }

            function createChart(canvasId, metricName, data, colorIndex) {
                const ctx = document.getElementById(canvasId);
                if (!ctx || !data || !data.length) return;

                const chartData = data.map(d => ({ x: d.step, y: d.value }));

                const datasets = [{
                    label: metricName,
                    data: chartData,
                    borderColor: colors[colorIndex % colors.length],
                    backgroundColor: colors[colorIndex % colors.length] + '20',
                    fill: true,
                    tension: 0.1,
                    pointRadius: data.length > 50 ? 0 : 3,
                    pointHoverRadius: 5,
                    borderWidth: 2,
                    _originalData: chartData,
                    _originalColor: colors[colorIndex % colors.length],
                    _runName: metricName,
                    _isOriginal: true
                }];

                chartInstances[canvasId] = createUnifiedChart(ctx, datasets, metricName, { isModal: false, enableZoom: false });
            }

            let chartIndex = 0;
            for (const [metric, data] of Object.entries(trainingMetrics)) {
                createChart('chart-training-' + metric.replace(/[^a-zA-Z0-9]/g, '_'), metric, data, chartIndex++);
            }
            chartIndex = 0;
            for (const [metric, data] of Object.entries(systemMetrics)) {
                createChart('chart-system-' + metric.replace(/[^a-zA-Z0-9]/g, '_'), metric, data, chartIndex++);
            }

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'updateData') {
                    console.log('[W&B Viewer] Live update received');
                    Object.assign(trainingMetrics, message.trainingMetrics);
                    Object.assign(systemMetrics, message.systemMetrics);
                    Object.keys(chartInstances).forEach(canvasId => {
                        const chart = chartInstances[canvasId];
                        if (chart && chart.data.datasets[0]) {
                            const metricName = chart.data.datasets[0]._runName;
                            const data = trainingMetrics[metricName] || systemMetrics[metricName];
                            if (data) {
                                const newData = data.map(d => ({ x: d.step, y: d.value }));
                                chart.data.datasets[0]._originalData = newData;
                                updateChartSmoothing(chart, globalSmoothing, showRaw);
                            }
                        }
                    });
                }
            });
        `;
    }
    getHtmlContent(webview, runData, logMetrics, runDir, outputLogPath, logoBase64) {
        const pathModule = require('path');
        // Merge metrics
        const allMetrics = { ...runData.metrics };
        for (const [key, values] of Object.entries(logMetrics)) {
            if (!allMetrics[key] || allMetrics[key].length === 0) {
                allMetrics[key] = values;
            }
        }
        // Group metrics
        const metricGroups = this.groupMetrics(allMetrics);
        const systemGroups = this.groupMetrics(runData.systemMetrics);
        // Load metadata
        let metadata = {};
        const metadataPath = pathModule.join(runDir, 'files', 'wandb-metadata.json');
        if (fs.existsSync(metadataPath)) {
            try {
                metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
            }
            catch { }
        }
        const projectName = runData.project || 'Unknown Project';
        const runName = runData.runName || runData.runId;
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>W&B Run Viewer</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js"></script>
    <style>
        ${this.generatePageStyles()}
        ${(0, chartTemplate_1.getChartStyles)()}
    </style>
</head>
<body>
    ${this.generateHeaderHtml(logoBase64, projectName, runName, runData.runId, outputLogPath)}
    ${this.generateMetadataHtml(metadata)}
    ${(0, chartTemplate_1.getControlsBarHtml)()}

    <div class="tabs">
        <button class="tab active" data-tab="training">Training Metrics</button>
        <button class="tab" data-tab="system">System Metrics</button>
        <button class="tab" data-tab="config">Configuration</button>
    </div>

    <div id="training" class="tab-content active">
        ${this.generateMetricGroupsHtml(metricGroups, 'training')}
    </div>

    <div id="system" class="tab-content">
        ${this.generateMetricGroupsHtml(systemGroups, 'system')}
    </div>

    <div id="config" class="tab-content">
        ${this.generateConfigHtml(runData.config)}
    </div>

    ${(0, chartTemplate_1.getModalHtml)()}

    <script>
        ${(0, chartTemplate_1.getChartScript)()}
        ${this.generateChartInitScript(allMetrics, runData.systemMetrics)}
    </script>
</body>
</html>`;
    }
    groupMetrics(metrics) {
        const groups = {};
        for (const [key, values] of Object.entries(metrics)) {
            if (!values || values.length === 0)
                continue;
            // Extract group name from the metric's natural hierarchy
            const groupName = this.extractGroupName(key);
            if (!groups[groupName])
                groups[groupName] = {};
            groups[groupName][key] = values;
        }
        // Sort groups
        const result = [];
        const allGroupNames = Object.keys(groups).sort((a, b) => {
            const priority = ['loss', 'accuracy', 'lr', 'optim', 'perf', 'time', 'step'];
            const aIdx = priority.findIndex(p => a.toLowerCase().startsWith(p));
            const bIdx = priority.findIndex(p => b.toLowerCase().startsWith(p));
            if (aIdx !== -1 && bIdx !== -1)
                return aIdx - bIdx;
            if (aIdx !== -1)
                return -1;
            if (bIdx !== -1)
                return 1;
            const aIsGpu = a.toLowerCase().startsWith('gpu');
            const bIsGpu = b.toLowerCase().startsWith('gpu');
            if (aIsGpu && bIsGpu)
                return a.localeCompare(b);
            if (aIsGpu)
                return 1;
            if (bIsGpu)
                return 1;
            return a.localeCompare(b);
        });
        for (const name of allGroupNames) {
            result.push({ name, metrics: groups[name] });
        }
        return result;
    }
    extractGroupName(key) {
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
    generateMetricGroupsHtml(groups, prefix) {
        if (groups.length === 0)
            return '<div class="no-data">No metrics found</div>';
        return groups.map(group => `
            <div class="metric-group">
                <h3>${group.name}</h3>
                <div class="charts-grid">
                    ${Object.keys(group.metrics).map(key => {
            const safeKey = key.replace(/[^a-zA-Z0-9]/g, '_');
            return `
                        <div class="chart-container">
                            <div class="chart-header">
                                <div class="chart-title">${key}</div>
                                <button class="btn-small" onclick="openFullscreen('${key.replace(/'/g, "\\'")}', '${prefix}')">⛶</button>
                            </div>
                            <div class="chart-wrapper">
                                <canvas id="chart-${prefix}-${safeKey}"></canvas>
                            </div>
                        </div>
                    `;
        }).join('')}
                </div>
            </div>
        `).join('');
    }
    generateConfigHtml(config) {
        if (Object.keys(config).length === 0)
            return '<div class="no-data">No configuration found</div>';
        return Object.entries(config).map(([key, value]) => `
            <div class="config-item">
                <div class="config-key">${key}</div>
                <div class="config-value">${typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}</div>
            </div>
        `).join('');
    }
}
WandbEditorProvider.viewType = 'wandb-viewer.wandbFile';
function deactivate() { }
//# sourceMappingURL=extension.js.map