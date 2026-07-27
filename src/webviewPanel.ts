import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { WandbRunData, WandbMetrics } from './wandbParser';

export class WandbViewerPanel {
    public static currentPanel: WandbViewerPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public static createOrShow(
        extensionUri: vscode.Uri,
        runData: WandbRunData,
        logMetrics: WandbMetrics,
        runDir: string,
        outputLogPath: string | null
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (WandbViewerPanel.currentPanel) {
            WandbViewerPanel.currentPanel._panel.reveal(column);
            WandbViewerPanel.currentPanel._update(runData, logMetrics, runDir, outputLogPath);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'wandbViewer',
            `W&B: ${runData.runId}`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        WandbViewerPanel.currentPanel = new WandbViewerPanel(panel, extensionUri);
        WandbViewerPanel.currentPanel._update(runData, logMetrics, runDir, outputLogPath);
    }

    private _update(
        runData: WandbRunData,
        logMetrics: WandbMetrics,
        runDir: string,
        outputLogPath: string | null
    ) {
        this._panel.webview.html = this._getHtmlContent(runData, logMetrics, runDir, outputLogPath);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'openOutputLog':
                        if (outputLogPath && fs.existsSync(outputLogPath)) {
                            const doc = await vscode.workspace.openTextDocument(outputLogPath);
                            await vscode.window.showTextDocument(doc);
                        } else {
                            vscode.window.showWarningMessage('Output log not found');
                        }
                        break;
                    case 'openFile':
                        const filePath = path.join(runDir, message.file);
                        if (fs.existsSync(filePath)) {
                            const doc = await vscode.workspace.openTextDocument(filePath);
                            await vscode.window.showTextDocument(doc);
                        }
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    private _getHtmlContent(
        runData: WandbRunData,
        logMetrics: WandbMetrics,
        runDir: string,
        outputLogPath: string | null
    ): string {
        // Merge metrics from wandb file and output log
        const allMetrics = { ...runData.metrics };

        // Add log metrics that don't exist in wandb data
        for (const [key, values] of Object.entries(logMetrics)) {
            if (!allMetrics[key] || allMetrics[key].length === 0) {
                allMetrics[key] = values;
            }
        }

        // Group metrics by category
        const metricGroups = groupMetrics(allMetrics);
        const systemGroups = groupMetrics(runData.systemMetrics);

        // Load metadata if available
        let metadata: any = {};
        const metadataPath = path.join(runDir, 'files', 'wandb-metadata.json');
        if (fs.existsSync(metadataPath)) {
            try {
                metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
            } catch { }
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>W&B Run Viewer</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * {
            box-sizing: border-box;
        }
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
            gap: 10px;
        }
        h1 {
            margin: 0;
            font-size: 1.5em;
            color: var(--vscode-foreground, #fff);
        }
        .btn {
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, #fff);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: background 0.2s;
        }
        .btn:hover {
            background: var(--vscode-button-hoverBackground, #1177bb);
        }
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .btn-group {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        .metadata {
            background: var(--vscode-editor-inactiveSelectionBackground, #3a3d41);
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .metadata h3 {
            margin: 0 0 10px 0;
            font-size: 1em;
        }
        .metadata-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 10px;
        }
        .metadata-item {
            font-size: 0.85em;
        }
        .metadata-label {
            color: var(--vscode-descriptionForeground, #888);
        }
        .tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 20px;
            border-bottom: 1px solid var(--vscode-panel-border, #444);
            padding-bottom: 0;
            flex-wrap: wrap;
        }
        .tab {
            padding: 8px 16px;
            cursor: pointer;
            border: none;
            background: transparent;
            color: var(--vscode-foreground, #d4d4d4);
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
        }
        .tab:hover {
            background: var(--vscode-list-hoverBackground, #2a2d2e);
        }
        .tab.active {
            border-bottom-color: var(--vscode-focusBorder, #007acc);
            color: var(--vscode-foreground, #fff);
        }
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }
        .metric-group {
            margin-bottom: 30px;
        }
        .metric-group h3 {
            margin: 0 0 15px 0;
            font-size: 1.1em;
            color: var(--vscode-foreground, #fff);
            border-bottom: 1px solid var(--vscode-panel-border, #444);
            padding-bottom: 8px;
        }
        .charts-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 20px;
        }
        .chart-container {
            background: var(--vscode-editor-inactiveSelectionBackground, #252526);
            padding: 15px;
            border-radius: 8px;
            min-height: 250px;
        }
        .chart-title {
            font-size: 0.9em;
            margin-bottom: 10px;
            color: var(--vscode-foreground, #d4d4d4);
        }
        .chart-wrapper {
            position: relative;
            height: 200px;
        }
        .no-data {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground, #888);
        }
        .config-section {
            margin-top: 20px;
        }
        .config-item {
            background: var(--vscode-editor-inactiveSelectionBackground, #252526);
            padding: 10px 15px;
            margin-bottom: 8px;
            border-radius: 4px;
        }
        .config-key {
            font-weight: bold;
            color: var(--vscode-symbolIcon-variableForeground, #75beff);
        }
        .config-value {
            font-family: monospace;
            font-size: 0.85em;
            margin-top: 5px;
            word-break: break-all;
            white-space: pre-wrap;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>W&B Run: ${runData.runId}</h1>
        <div class="btn-group">
            <button class="btn" onclick="openOutputLog()" ${!outputLogPath ? 'disabled' : ''}>
                View Output Log
            </button>
        </div>
    </div>

    ${metadata.gpu || metadata.python ? `
    <div class="metadata">
        <h3>Run Information</h3>
        <div class="metadata-grid">
            ${metadata.gpu ? `<div class="metadata-item"><span class="metadata-label">GPU:</span> ${metadata.gpu}</div>` : ''}
            ${metadata.gpu_count ? `<div class="metadata-item"><span class="metadata-label">GPU Count:</span> ${metadata.gpu_count}</div>` : ''}
            ${metadata.python ? `<div class="metadata-item"><span class="metadata-label">Python:</span> ${metadata.python}</div>` : ''}
            ${metadata.os ? `<div class="metadata-item"><span class="metadata-label">OS:</span> ${metadata.os}</div>` : ''}
            ${metadata.host ? `<div class="metadata-item"><span class="metadata-label">Host:</span> ${metadata.host}</div>` : ''}
            ${metadata.startedAt ? `<div class="metadata-item"><span class="metadata-label">Started:</span> ${new Date(metadata.startedAt).toLocaleString()}</div>` : ''}
        </div>
    </div>
    ` : ''}

    <div class="tabs">
        <button class="tab active" data-tab="training">Training Metrics</button>
        <button class="tab" data-tab="system">System Metrics</button>
        <button class="tab" data-tab="config">Configuration</button>
    </div>

    <div id="training" class="tab-content active">
        ${generateMetricGroupsHtml(metricGroups, 'training')}
    </div>

    <div id="system" class="tab-content">
        ${generateMetricGroupsHtml(systemGroups, 'system')}
    </div>

    <div id="config" class="tab-content">
        <div class="config-section">
            ${generateConfigHtml(runData.config)}
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        // Tab switching
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(tab.dataset.tab).classList.add('active');
            });
        });

        function openOutputLog() {
            vscode.postMessage({ command: 'openOutputLog' });
        }

        // Chart colors
        const colors = [
            '#4dc9f6', '#f67019', '#f53794', '#537bc4', '#acc236',
            '#166a8f', '#00a950', '#58595b', '#8549ba', '#ff6384'
        ];

        // Metric data
        const trainingMetrics = ${JSON.stringify(allMetrics)};
        const systemMetrics = ${JSON.stringify(runData.systemMetrics)};

        // Create charts for all metrics
        function createChart(canvasId, label, data, colorIndex = 0) {
            const ctx = document.getElementById(canvasId);
            if (!ctx || !data || data.length === 0) return;

            const color = colors[colorIndex % colors.length];

            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: data.map(d => d.step),
                    datasets: [{
                        label: label,
                        data: data.map(d => d.value),
                        borderColor: color,
                        backgroundColor: color + '20',
                        fill: false,
                        tension: 0.1,
                        pointRadius: data.length > 50 ? 0 : 3,
                        pointHoverRadius: 5
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    },
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    let value = context.parsed.y;
                                    if (Math.abs(value) < 0.001 || Math.abs(value) > 10000) {
                                        return label + ': ' + value.toExponential(4);
                                    }
                                    return label + ': ' + value.toFixed(4);
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            title: {
                                display: true,
                                text: 'Step',
                                color: '#888'
                            },
                            grid: {
                                color: '#333'
                            },
                            ticks: {
                                color: '#888'
                            }
                        },
                        y: {
                            title: {
                                display: true,
                                text: label,
                                color: '#888'
                            },
                            grid: {
                                color: '#333'
                            },
                            ticks: {
                                color: '#888',
                                callback: function(value) {
                                    if (Math.abs(value) < 0.001 || Math.abs(value) > 10000) {
                                        return value.toExponential(2);
                                    }
                                    return value.toFixed(2);
                                }
                            }
                        }
                    }
                }
            });
        }

        // Initialize all charts
        let chartIndex = 0;
        for (const [metric, data] of Object.entries(trainingMetrics)) {
            createChart('chart-training-' + metric.replace(/[^a-zA-Z0-9]/g, '_'), metric, data, chartIndex++);
        }
        chartIndex = 0;
        for (const [metric, data] of Object.entries(systemMetrics)) {
            createChart('chart-system-' + metric.replace(/[^a-zA-Z0-9]/g, '_'), metric, data, chartIndex++);
        }
    </script>
</body>
</html>`;
    }

    public dispose() {
        WandbViewerPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

interface MetricGroup {
    name: string;
    metrics: { [key: string]: any[] };
}

function groupMetrics(metrics: WandbMetrics): MetricGroup[] {
    // Extract group name from the metric's natural hierarchy - NO HARDCODING
    const groups: { [key: string]: { [key: string]: any[] } } = {};

    for (const [key, values] of Object.entries(metrics)) {
        if (!values || values.length === 0) continue;

        const groupName = extractGroupName(key);

        if (!groups[groupName]) {
            groups[groupName] = {};
        }
        groups[groupName][key] = values;
    }

    // Sort groups: alphabetically, but with common training metrics first
    const result: MetricGroup[] = [];
    const allGroupNames = Object.keys(groups).sort((a, b) => {
        // Priority groups come first (if they exist)
        const priority = ['loss', 'accuracy', 'lr', 'optim', 'perf', 'time', 'step'];
        const aIdx = priority.findIndex(p => a.toLowerCase().startsWith(p));
        const bIdx = priority.findIndex(p => b.toLowerCase().startsWith(p));

        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;

        // GPU groups come after priority groups but before others
        const aIsGpu = a.toLowerCase().startsWith('gpu');
        const bIsGpu = b.toLowerCase().startsWith('gpu');
        if (aIsGpu && bIsGpu) return a.localeCompare(b);
        if (aIsGpu) return 1;
        if (bIsGpu) return 1;

        return a.localeCompare(b);
    });

    for (const name of allGroupNames) {
        result.push({ name, metrics: groups[name] });
    }

    return result;
}

function extractGroupName(key: string): string {
    // Handle hierarchical names with / (e.g., "loss/mean" -> "loss")
    if (key.includes('/')) {
        return key.split('/')[0];
    }

    // Handle dot-separated names (e.g., "gpu.0.memory" -> "gpu.0")
    if (key.includes('.')) {
        const parts = key.split('.');
        // For gpu.X.metric, group by gpu.X
        if (parts[0] === 'gpu' && parts.length >= 3) {
            return `gpu.${parts[1]}`;
        }
        // For other dot-separated names, use first component
        return parts[0];
    }

    // Handle underscore-separated names with common prefixes
    // e.g., "train_loss" -> "train", "val_accuracy" -> "val"
    if (key.includes('_')) {
        const parts = key.split('_');
        const commonPrefixes = ['train', 'val', 'test', 'eval'];
        if (commonPrefixes.includes(parts[0])) {
            return parts[0];
        }
    }

    // For simple names without hierarchy, use the full name as the group
    return key;
}

function generateMetricGroupsHtml(groups: MetricGroup[], prefix: string): string {
    if (groups.length === 0) {
        return '<div class="no-data">No metrics found</div>';
    }

    return groups.map(group => `
        <div class="metric-group">
            <h3>${group.name}</h3>
            <div class="charts-grid">
                ${Object.entries(group.metrics).map(([key, _]) => `
                    <div class="chart-container">
                        <div class="chart-title">${key}</div>
                        <div class="chart-wrapper">
                            <canvas id="chart-${prefix}-${key.replace(/[^a-zA-Z0-9]/g, '_')}"></canvas>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

function generateConfigHtml(config: { [key: string]: any }): string {
    if (Object.keys(config).length === 0) {
        return '<div class="no-data">No configuration found</div>';
    }

    return Object.entries(config).map(([key, value]) => `
        <div class="config-item">
            <div class="config-key">${key}</div>
            <div class="config-value">${typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}</div>
        </div>
    `).join('');
}
