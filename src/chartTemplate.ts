import { RUN_COLORS } from './runColors';

/**
 * Unified chart template for both single-run and multi-run views
 * Consolidates all Chart.js rendering logic into one clean implementation
 */

/**
 * Returns unified chart CSS styles
 */
export function getChartStyles(): string {
    return `
        * { box-sizing: border-box; }

        body.modal-open { overflow: hidden; }

        .controls-bar {
            padding: 15px 20px;
            background: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-panel-border, #444);
            display: flex;
            gap: 15px;
            align-items: center;
            flex-wrap: wrap;
        }

        .control-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .control-group label {
            font-size: 0.9em;
            white-space: nowrap;
        }

        .control-group input[type="text"] {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 0.9em;
            width: 200px;
        }

        .control-group input[type="text"]:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        .control-group input[type="checkbox"] {
            cursor: pointer;
            width: 16px;
            height: 16px;
        }

        input[type="range"] {
            width: 120px;
            cursor: pointer;
            -webkit-appearance: none;
            appearance: none;
            background: transparent;
            height: 20px;
        }

        input[type="range"]::-webkit-slider-runnable-track {
            height: 4px;
            background: #444;
            border-radius: 2px;
        }

        input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 14px;
            height: 14px;
            background: #888;
            border-radius: 50%;
            margin-top: -5px;
            cursor: pointer;
        }

        input[type="range"]::-webkit-slider-thumb:hover { background: #aaa; }

        input[type="range"]::-moz-range-track {
            height: 4px;
            background: #444;
            border-radius: 2px;
        }

        input[type="range"]::-moz-range-thumb {
            width: 14px;
            height: 14px;
            background: #888;
            border-radius: 50%;
            border: none;
            cursor: pointer;
        }

        input[type="range"]::-moz-range-thumb:hover { background: #aaa; }
        input[type="range"]:focus { outline: none; }

        .smoothing-value {
            min-width: 35px;
            text-align: right;
            font-family: monospace;
            font-size: 0.9em;
        }

        .toggle-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-button-border);
            padding: 4px 10px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 0.85em;
        }

        .toggle-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .toggle-btn.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .axis-toggles {
            display: flex;
            gap: 8px;
        }

        .ai-context-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 13px;
            position: relative;
        }

        .ai-context-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .ai-context-menu {
            position: absolute;
            background: var(--vscode-menu-background);
            border: 1px solid var(--vscode-menu-border);
            border-radius: 3px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            z-index: 1000;
            margin-top: 2px;
            min-width: 180px;
            right: 0;
        }

        .ai-context-menu button {
            display: block;
            width: 100%;
            padding: 8px 16px;
            text-align: left;
            background: transparent;
            border: none;
            cursor: pointer;
            color: var(--vscode-menu-foreground);
            font-size: 13px;
        }

        .ai-context-menu button:hover {
            background: var(--vscode-menu-selectionBackground);
        }

        .capture-status {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-focusBorder);
            padding: 20px 30px;
            border-radius: 8px;
            z-index: 2000;
            text-align: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            font-size: 14px;
            color: var(--vscode-foreground);
        }

        .capture-status .spinner-small {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid var(--vscode-foreground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-right: 8px;
            vertical-align: middle;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 20px;
            border-bottom: 1px solid var(--vscode-panel-border, #444);
            flex-wrap: wrap;
        }

        .tab {
            padding: 8px 16px;
            cursor: pointer;
            border: none;
            background: transparent;
            color: var(--vscode-foreground);
            border-bottom: 2px solid transparent;
        }

        .tab:hover { background: var(--vscode-list-hoverBackground); }
        .tab.active { border-bottom-color: var(--vscode-focusBorder, #007acc); }
        .tab-content { display: none; }
        .tab-content.active { display: block; }

        .metric-group {
            margin-bottom: 30px;
        }

        .metric-group.hidden { display: none; }

        .metric-group h3 {
            margin: 0 0 15px 0;
            font-size: 1.1em;
            border-bottom: 1px solid var(--vscode-panel-border, #444);
            padding-bottom: 8px;
        }

        .charts-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 20px;
        }

        .chart-container, .metric-card {
            background: var(--vscode-editor-inactiveSelectionBackground, #252526);
            padding: 15px;
            border-radius: 8px;
            min-height: 250px;
            position: relative;
        }

        .chart-container.hidden, .metric-card.hidden { display: none; }

        .chart-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }

        .chart-actions {
            display: flex;
            gap: 4px;
        }

        .chart-title, .metric-title {
            font-size: 1em;
            font-weight: 600;
        }

        .chart-wrapper {
            position: relative;
            height: 200px;
        }

        .range-interactive-chart {
            cursor: crosshair;
            touch-action: none;
        }

        .btn-small, .btn-fullscreen {
            background: transparent;
            border: 1px solid var(--vscode-button-border);
            color: var(--vscode-foreground);
            padding: 4px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 14px;
            opacity: 0.7;
            transition: opacity 0.2s;
        }

        .btn-small:hover, .btn-fullscreen:hover { opacity: 1; }

        .no-data {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground, #888);
        }

        /* Modal */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: var(--vscode-editor-background);
            z-index: 1000;
            padding: 20px;
            flex-direction: column;
        }

        .modal.active { display: flex; }

        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }

        .modal-title {
            font-size: 1.4em;
            font-weight: 600;
        }

        .modal-controls {
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .modal-close {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            font-size: 24px;
            cursor: pointer;
            padding: 5px 10px;
        }

        .modal-close:hover { color: var(--vscode-errorForeground, #f48771); }

        .modal-content {
            flex: 1;
            position: relative;
            min-height: 0;
            overflow: hidden;
        }

        .modal-chart {
            position: absolute;
            top: 0;
            left: 0;
            width: 100% !important;
            height: 100% !important;
        }

        .zoom-hint {
            font-size: 0.75em;
            color: var(--vscode-descriptionForeground, #666);
            font-style: italic;
        }
    `;
}

/**
 * Returns unified chart JavaScript code
 */
export function getChartScript(): string {
    return `
        // ==================== CONSTANTS ====================
        const CHART_COLORS = ${JSON.stringify(RUN_COLORS)};

        // ==================== STATE ====================
        let chartInstances = {};
        let modalChart = null;
        let globalSmoothing = 0;
        let showRaw = true;
        let modalShowRaw = true;
        let logX = false;
        let logY = false;
        let modalLogX = false;
        let modalLogY = false;
        let textContextMenuOpen = false;
        let chartImageMenuOpen = false;

        // ==================== CORE FUNCTIONS ====================

        function readThemeColor(variableName, fallback) {
            const value = getComputedStyle(document.body)
                .getPropertyValue(variableName)
                .trim();
            return value || fallback;
        }

        function getChartThemeColors() {
            const isLightTheme = document.body.classList.contains('vscode-light') ||
                document.body.classList.contains('vscode-high-contrast-light');
            return {
                foreground: readThemeColor(
                    '--vscode-foreground',
                    isLightTheme ? '#1f1f1f' : '#d4d4d4'
                ),
                muted: readThemeColor(
                    '--vscode-descriptionForeground',
                    isLightTheme ? '#616161' : '#aaaaaa'
                ),
                grid: readThemeColor(
                    '--vscode-panel-border',
                    isLightTheme ? 'rgba(31, 31, 31, 0.18)' : 'rgba(212, 212, 212, 0.18)'
                )
            };
        }

        function applyChartTheme(chart, update = false) {
            if (!chart || !chart.options) return;

            const themeColors = getChartThemeColors();
            const legendLabels = chart.options.plugins &&
                chart.options.plugins.legend &&
                chart.options.plugins.legend.labels;
            if (legendLabels) {
                legendLabels.color = themeColors.foreground;
            }

            ['x', 'y'].forEach(axis => {
                const scale = chart.options.scales && chart.options.scales[axis];
                if (!scale) return;

                if (scale.title) {
                    scale.title.color = themeColors.muted;
                }
                if (scale.grid) {
                    scale.grid.color = themeColors.grid;
                }
                if (scale.ticks) {
                    scale.ticks.color = themeColors.muted;
                }
            });

            if (update) {
                chart.update('none');
            }
        }

        let chartThemeSignature = JSON.stringify(getChartThemeColors());
        const chartThemeObserver = new MutationObserver(() => {
            const nextSignature = JSON.stringify(getChartThemeColors());
            if (nextSignature === chartThemeSignature) {
                return;
            }

            chartThemeSignature = nextSignature;
            Object.values(chartInstances).forEach(chart => {
                applyChartTheme(chart, true);
            });
            applyChartTheme(modalChart, true);
        });
        chartThemeObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['class', 'style']
        });

        const RANGE_BOX_THRESHOLD = 20;
        const RANGE_MIN_DISTANCE = 8;

        const rangeSelectionPlugin = {
            id: 'rangeSelection',
            afterDraw(chart) {
                const selection = chart.$rangeSelection;
                if (!selection) return;

                const ctx = chart.ctx;
                const left = Math.min(selection.start.x, selection.end.x);
                const right = Math.max(selection.start.x, selection.end.x);
                const top = Math.min(selection.start.y, selection.end.y);
                const bottom = Math.max(selection.start.y, selection.end.y);
                const isBox = Math.abs(selection.end.y - selection.start.y) >= RANGE_BOX_THRESHOLD;

                ctx.save();
                if (isBox) {
                    ctx.fillStyle = 'rgba(0, 122, 204, 0.16)';
                    ctx.strokeStyle = 'rgba(0, 122, 204, 0.9)';
                    ctx.lineWidth = 1;
                    ctx.fillRect(left, top, right - left, bottom - top);
                    ctx.strokeRect(left, top, right - left, bottom - top);
                } else {
                    ctx.strokeStyle = 'rgba(0, 122, 204, 0.95)';
                    ctx.lineWidth = 3;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.moveTo(selection.start.x, selection.start.y);
                    ctx.lineTo(selection.end.x, selection.start.y);
                    ctx.stroke();
                }
                ctx.restore();
            },
            afterDestroy(chart) {
                if (chart.$rangeInteractionCleanup) {
                    chart.$rangeInteractionCleanup();
                }
            }
        };

        const tooltipRunHighlightPlugin = {
            id: 'tooltipRunHighlight',
            afterTooltipDraw(chart, args) {
                const tooltip = args.tooltip;
                const hoveredRunKey = chart.$hoveredRunKey;
                if (!tooltip || tooltip.opacity === 0 || !hoveredRunKey) return;

                const hoveredIndex = tooltip.dataPoints.findIndex(context =>
                    getDatasetRunKey(context.dataset) === hoveredRunKey
                );
                if (hoveredIndex < 0) return;

                const tooltipOptions = tooltip.options;
                const padding = Chart.helpers.toPadding(tooltipOptions.padding);
                const titleFont = Chart.helpers.toFont(tooltipOptions.titleFont);
                const bodyFont = Chart.helpers.toFont(tooltipOptions.bodyFont);
                const titleLines = tooltip.title ? tooltip.title.length : 0;
                const titleHeight = titleLines > 0
                    ? titleLines * titleFont.lineHeight +
                        (titleLines - 1) * tooltipOptions.titleSpacing +
                        tooltipOptions.titleMarginBottom
                    : 0;
                const rowHeight = bodyFont.lineHeight + tooltipOptions.bodySpacing;
                const rowTop = tooltip.y + padding.top + titleHeight +
                    hoveredIndex * rowHeight;
                const swatchSpace = tooltipOptions.displayColors
                    ? bodyFont.size + 4
                    : 0;
                const highlightLeft = tooltip.x + padding.left + swatchSpace;
                const highlightWidth = Math.max(
                    0,
                    tooltip.width - padding.right - (highlightLeft - tooltip.x)
                );

                chart.ctx.save();
                chart.ctx.fillStyle = 'rgba(160, 160, 160, 0.2)';
                chart.ctx.fillRect(
                    highlightLeft - 2,
                    rowTop,
                    highlightWidth + 2,
                    bodyFont.lineHeight
                );
                chart.ctx.restore();
            }
        };

        function getChartPointerPosition(chart, event) {
            const rect = chart.canvas.getBoundingClientRect();
            const area = chart.chartArea;
            return {
                x: Math.min(area.right, Math.max(area.left, event.clientX - rect.left)),
                y: Math.min(area.bottom, Math.max(area.top, event.clientY - rect.top))
            };
        }

        function isPointInChartArea(chart, point) {
            const area = chart.chartArea;
            return point.x >= area.left && point.x <= area.right &&
                point.y >= area.top && point.y <= area.bottom;
        }

        function fitYAxisToVisibleX(chart, minX, maxX) {
            const logarithmic = chart.scales.y.type === 'logarithmic';
            let minY = Infinity;
            let maxY = -Infinity;

            chart.data.datasets.forEach((dataset, datasetIndex) => {
                if (!chart.isDatasetVisible(datasetIndex)) return;

                dataset.data.forEach(point => {
                    if (!point || typeof point !== 'object') return;

                    const x = Number(point.x);
                    const y = Number(point.y);
                    if (
                        !Number.isFinite(x) ||
                        !Number.isFinite(y) ||
                        x < minX ||
                        x > maxX ||
                        (logarithmic && y <= 0)
                    ) {
                        return;
                    }

                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y);
                });
            });

            if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return;

            if (logarithmic) {
                const paddingFactor = minY === maxY
                    ? 1.1
                    : Math.pow(maxY / minY, 0.05);
                minY /= paddingFactor;
                maxY *= paddingFactor;
            } else {
                const range = maxY - minY;
                const padding = range === 0
                    ? Math.max(Math.abs(minY) * 0.05, 1e-9)
                    : range * 0.05;
                minY -= padding;
                maxY += padding;
            }

            chart.zoomScale('y', { min: minY, max: maxY }, 'none');
        }

        function installRangeInteractions(chart) {
            const canvas = chart.canvas;
            let gesture = null;

            canvas.classList.add('range-interactive-chart');

            const finishGesture = event => {
                if (!gesture) return;

                if (gesture.type === 'select' && event.type !== 'pointercancel') {
                    const selection = chart.$rangeSelection;
                    if (selection) {
                        const distanceX = Math.abs(selection.end.x - selection.start.x);
                        const distanceY = Math.abs(selection.end.y - selection.start.y);

                        if (distanceX >= RANGE_MIN_DISTANCE) {
                            const xScale = chart.scales.x;
                            const xStart = xScale.getValueForPixel(selection.start.x);
                            const xEnd = xScale.getValueForPixel(selection.end.x);
                            const xRange = {
                                min: Math.min(xStart, xEnd),
                                max: Math.max(xStart, xEnd)
                            };
                            const isBox = distanceY >= RANGE_BOX_THRESHOLD;
                            let yRange = null;

                            if (isBox) {
                                const yScale = chart.scales.y;
                                const yStart = yScale.getValueForPixel(selection.start.y);
                                const yEnd = yScale.getValueForPixel(selection.end.y);
                                yRange = {
                                    min: Math.min(yStart, yEnd),
                                    max: Math.max(yStart, yEnd)
                                };
                            }

                            chart.zoomScale('x', xRange, 'none');

                            if (yRange) {
                                chart.zoomScale('y', yRange, 'none');
                            } else {
                                fitYAxisToVisibleX(chart, xRange.min, xRange.max);
                            }
                        }
                    }
                }
                chart.$rangeSelection = null;
                chart.draw();

                if (canvas.hasPointerCapture(event.pointerId)) {
                    canvas.releasePointerCapture(event.pointerId);
                }
                gesture = null;
                canvas.style.cursor = '';
            };

            const onPointerDown = event => {
                if (event.button !== 0) return;

                const point = getChartPointerPosition(chart, event);
                if (!isPointInChartArea(chart, point)) return;

                gesture = {
                    type: event.shiftKey ? 'pan' : 'select',
                    start: point,
                    last: point
                };
                canvas.setPointerCapture(event.pointerId);
                canvas.style.cursor = gesture.type === 'pan' ? 'grabbing' : 'crosshair';

                if (gesture.type === 'select') {
                    chart.$rangeSelection = { start: point, end: point };
                    chart.draw();
                }
                event.preventDefault();
            };

            const onPointerMove = event => {
                if (!gesture) return;

                const point = getChartPointerPosition(chart, event);
                if (gesture.type === 'pan') {
                    const deltaX = point.x - gesture.last.x;
                    const deltaY = point.y - gesture.last.y;
                    if (deltaX !== 0 || deltaY !== 0) {
                        chart.pan(
                            { x: deltaX, y: deltaY },
                            [chart.scales.x, chart.scales.y],
                            'none'
                        );
                    }
                    gesture.last = point;
                } else {
                    chart.$rangeSelection.end = point;
                    chart.draw();
                }
                event.preventDefault();
            };

            const onDoubleClick = event => {
                chart.resetZoom('none');
                event.preventDefault();
            };

            canvas.addEventListener('pointerdown', onPointerDown);
            canvas.addEventListener('pointermove', onPointerMove);
            canvas.addEventListener('pointerup', finishGesture);
            canvas.addEventListener('pointercancel', finishGesture);
            canvas.addEventListener('dblclick', onDoubleClick);

            chart.$rangeInteractionCleanup = () => {
                canvas.removeEventListener('pointerdown', onPointerDown);
                canvas.removeEventListener('pointermove', onPointerMove);
                canvas.removeEventListener('pointerup', finishGesture);
                canvas.removeEventListener('pointercancel', finishGesture);
                canvas.removeEventListener('dblclick', onDoubleClick);
                canvas.classList.remove('range-interactive-chart');
                canvas.style.cursor = '';
            };
        }

        /**
         * EMA smoothing algorithm
         */
        function applySmoothing(values, factor) {
            if (factor === 0 || values.length === 0) return values;

            const smoothed = [];
            let last = values[0];

            for (let i = 0; i < values.length; i++) {
                const smoothedValue = factor * last + (1 - factor) * values[i];
                smoothed.push(smoothedValue);
                last = smoothedValue;
            }

            return smoothed;
        }

        function getDatasetRunKey(dataset) {
            return dataset && (dataset._runId || dataset._runName);
        }

        function withColorAlpha(color, alpha) {
            if (typeof color !== 'string') return color;

            const alphaHex = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
                .toString(16)
                .padStart(2, '0');
            if (/^#[0-9a-f]{6}$/i.test(color)) {
                return color + alphaHex;
            }
            if (/^#[0-9a-f]{8}$/i.test(color)) {
                return color.slice(0, 7) + alphaHex;
            }
            return color;
        }

        function restoreHoveredRunStyles(chart) {
            chart.data.datasets.forEach(dataset => {
                const baseStyle = dataset.$hoverBaseStyle;
                if (!baseStyle) return;

                dataset.borderColor = baseStyle.borderColor;
                dataset.backgroundColor = baseStyle.backgroundColor;
                dataset.borderWidth = baseStyle.borderWidth;
                delete dataset.$hoverBaseStyle;
            });
        }

        function setHoveredRun(chart, runKey, highlightLine = false) {
            if (!chart) return;
            if (!runKey) {
                clearHoveredRun(chart);
                return;
            }
            if (
                chart.$hoveredRunKey === runKey &&
                chart.$hoverHighlightsLine === highlightLine
            ) {
                return;
            }

            restoreHoveredRunStyles(chart);
            if (highlightLine) {
                chart.data.datasets.forEach(dataset => {
                    dataset.$hoverBaseStyle = {
                        borderColor: dataset.borderColor,
                        backgroundColor: dataset.backgroundColor,
                        borderWidth: dataset.borderWidth
                    };

                    const baseStyle = dataset.$hoverBaseStyle;
                    const isHoveredRun = getDatasetRunKey(dataset) === runKey;
                    dataset.borderColor = !isHoveredRun
                        ? withColorAlpha(baseStyle.borderColor, 0.18)
                        : baseStyle.borderColor;
                    dataset.backgroundColor = !isHoveredRun
                        ? withColorAlpha(baseStyle.backgroundColor, 0.08)
                        : baseStyle.backgroundColor;
                    dataset.borderWidth = isHoveredRun
                        ? Math.max(Number(baseStyle.borderWidth) || 2, 2) + 2
                        : baseStyle.borderWidth;
                });
            }

            chart.$hoveredRunKey = runKey;
            chart.$hoverHighlightsLine = highlightLine;
            chart.update('none');
        }

        function clearHoveredRun(chart, update = true) {
            if (!chart || !chart.$hoveredRunKey) return;

            restoreHoveredRunStyles(chart);
            chart.$hoveredRunKey = null;
            chart.$hoverHighlightsLine = false;
            if (update) {
                chart.update('none');
            }
        }

        function findHoveredRunKey(chart, event, activeElements) {
            if (!chart || !activeElements || activeElements.length === 0) {
                return null;
            }

            const pointerY = Number(event && event.y);
            let closest = null;
            let closestDistance = Infinity;
            activeElements.forEach(active => {
                const dataset = chart.data.datasets[active.datasetIndex];
                const runKey = getDatasetRunKey(dataset);
                if (!runKey || !active.element) return;

                const distance = Number.isFinite(pointerY)
                    ? Math.abs(active.element.y - pointerY)
                    : 0;
                if (distance < closestDistance) {
                    closest = runKey;
                    closestDistance = distance;
                }
            });
            return closest;
        }

        /**
         * Create unified Chart.js chart
         */
        function createUnifiedChart(ctx, datasets, metricName, options = {}) {
            // Calculate max dataset size for decimation
            const maxPoints = Math.max(...datasets.map(d => d.data ? d.data.length : 0), 0);
            const themeColors = getChartThemeColors();

            const chart = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets
                },
                plugins: [
                    ...(options.enableZoom ? [rangeSelectionPlugin] : []),
                    tooltipRunHighlightPlugin
                ],
                options: {
                    parsing: {
                        xAxisKey: 'x',
                        yAxisKey: 'y'
                    },
                    decimation: maxPoints > 500 ? {
                        enabled: true,
                        algorithm: 'lttb',
                        samples: 250,
                        threshold: 500
                    } : {
                        enabled: false
                    },
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { intersect: false, mode: 'index' },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            onHover: function(_event, legendItem, legend) {
                                const chart = legend.chart;
                                const dataset = chart.data.datasets[legendItem.datasetIndex];
                                const runKey = getDatasetRunKey(dataset);
                                setHoveredRun(chart, runKey, true);
                                chart.canvas.style.cursor = 'pointer';
                            },
                            onLeave: function(_event, _legendItem, legend) {
                                clearHoveredRun(legend.chart);
                                legend.chart.canvas.style.cursor = '';
                            },
                            onClick: function(event, legendItem, legend) {
                                const chart = legend.chart;
                                const clickedDataset = chart.data.datasets[legendItem.datasetIndex];
                                if (!clickedDataset) return;

                                const runKey = clickedDataset._runId || clickedDataset._runName;
                                const setRunVisibility = (targetRunKey, visible) => {
                                    chart.data.datasets.forEach((dataset, datasetIndex) => {
                                        const datasetRunKey = dataset._runId || dataset._runName;
                                        if (datasetRunKey === targetRunKey) {
                                            chart.setDatasetVisibility(datasetIndex, visible);
                                        }
                                    });
                                };
                                const clickCount = event.native && event.native.detail
                                    ? event.native.detail
                                    : 1;

                                if (clickCount > 1) {
                                    if (chart.$legendClickTimer) {
                                        clearTimeout(chart.$legendClickTimer);
                                        chart.$legendClickTimer = null;
                                    }

                                    if (chart.$isolatedRunKey === runKey) {
                                        chart.data.datasets.forEach((_dataset, datasetIndex) => {
                                            chart.setDatasetVisibility(datasetIndex, true);
                                        });
                                        chart.$isolatedRunKey = null;
                                    } else {
                                        chart.data.datasets.forEach((dataset, datasetIndex) => {
                                            const datasetRunKey = dataset._runId || dataset._runName;
                                            chart.setDatasetVisibility(datasetIndex, datasetRunKey === runKey);
                                        });
                                        chart.$isolatedRunKey = runKey;
                                    }
                                    chart.update();
                                    return;
                                }

                                if (chart.$legendClickTimer) {
                                    clearTimeout(chart.$legendClickTimer);
                                }
                                chart.$legendClickTimer = setTimeout(() => {
                                    const runIsVisible = chart.data.datasets.some((dataset, datasetIndex) => {
                                        const datasetRunKey = dataset._runId || dataset._runName;
                                        return datasetRunKey === runKey &&
                                            chart.isDatasetVisible(datasetIndex);
                                    });
                                    setRunVisibility(runKey, !runIsVisible);
                                    chart.$isolatedRunKey = null;
                                    chart.$legendClickTimer = null;
                                    chart.update();
                                }, 250);
                            },
                            labels: {
                                color: themeColors.foreground,
                                usePointStyle: true,
                                padding: 10,
                                font: { size: options.isModal ? 12 : 11 },
                                generateLabels: function(chart) {
                                    const labels = Chart.defaults.plugins.legend.labels
                                        .generateLabels(chart);
                                    const hoveredRunKey = chart.$hoveredRunKey;
                                    if (!hoveredRunKey) {
                                        return labels;
                                    }

                                    const currentTheme = getChartThemeColors();
                                    return labels.map(item => {
                                        const dataset = chart.data.datasets[item.datasetIndex];
                                        const isHovered = getDatasetRunKey(dataset) === hoveredRunKey;
                                        return {
                                            ...item,
                                            fillStyle: isHovered
                                                ? item.fillStyle
                                                : withColorAlpha(item.fillStyle, 0.18),
                                            strokeStyle: isHovered
                                                ? item.strokeStyle
                                                : withColorAlpha(item.strokeStyle, 0.18),
                                            fontColor: isHovered
                                                ? currentTheme.foreground
                                                : currentTheme.muted,
                                            lineWidth: isHovered ? 3 : item.lineWidth
                                        };
                                    });
                                },
                                filter: (item, data) => !data.datasets[item.datasetIndex]._isRaw
                            }
                        },
                        tooltip: {
                            itemSort: function(first, second) {
                                return Number(second.parsed.y) - Number(first.parsed.y);
                            },
                            filter: function(context) {
                                return !context.dataset._isRaw;
                            },
                            callbacks: {
                                labelColor: function(context) {
                                    const color = context.dataset.borderColor;
                                    const isHovered = getDatasetRunKey(context.dataset) ===
                                        context.chart.$hoveredRunKey;
                                    return {
                                        borderColor: color,
                                        backgroundColor: isHovered
                                            ? color
                                            : withColorAlpha(color, 0.12),
                                        borderWidth: isHovered ? 0 : 2
                                    };
                                },
                                label: function(context) {
                                    const label = context.dataset.label || '';
                                    const value = context.parsed.y;
                                    const decimals = options.isModal ? 6 : 4;
                                    const formatValue = rawValue =>
                                        Math.abs(rawValue) < 0.001 || Math.abs(rawValue) > 10000
                                            ? rawValue.toExponential(decimals)
                                            : rawValue.toFixed(decimals);
                                    const formatted = formatValue(value);
                                    const runKey = context.dataset._runId || context.dataset._runName;
                                    const rawDataset = context.chart.data.datasets.find(dataset => {
                                        const datasetRunKey = dataset._runId || dataset._runName;
                                        return dataset._isRaw && datasetRunKey === runKey;
                                    });
                                    const rawPoint = rawDataset && rawDataset.data[context.dataIndex];
                                    const rawValue = rawPoint && typeof rawPoint === 'object'
                                        ? Number(rawPoint.y)
                                        : NaN;
                                    const rawSuffix = Number.isFinite(rawValue)
                                        ? ' (' + formatValue(rawValue) + ')'
                                        : '';
                                    return label + ': ' + formatted + rawSuffix;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            type: 'linear',
                            title: {
                                display: true,
                                text: 'Step',
                                color: themeColors.muted,
                                font: { size: options.isModal ? 14 : 12, weight: 'bold' }
                            },
                            grid: { color: themeColors.grid },
                            ticks: { color: themeColors.muted, font: { size: options.isModal ? 12 : 11 } }
                        },
                        y: {
                            type: 'linear',
                            title: {
                                display: true,
                                text: metricName,
                                color: themeColors.muted,
                                font: { size: options.isModal ? 14 : 12, weight: 'bold' }
                            },
                            grid: { color: themeColors.grid },
                            ticks: {
                                color: themeColors.muted,
                                font: { size: options.isModal ? 12 : 11 },
                                callback: function(value) {
                                    const decimals = options.isModal ? 4 : 2;
                                    
                                    // Always use exponential for very small or very large numbers
                                    if (Math.abs(value) < 0.001 || Math.abs(value) > 10000) {
                                        return value.toExponential(2);
                                    }
                                    
                                    // For values in normal range, check if toFixed would show significant digits
                                    const formatted = value.toFixed(decimals);
                                    const asNumber = parseFloat(formatted);
                                    
                                    // If toFixed rounds to zero but value isn't actually zero, use exponential
                                    if (asNumber === 0 && value !== 0) {
                                        return value.toExponential(2);
                                    }
                                    
                                    return formatted;
                                }
                            }
                        }
                    },
                    onHover: function(event, activeElements, chart) {
                        setHoveredRun(
                            chart,
                            findHoveredRunKey(chart, event, activeElements)
                        );
                        if (options.onHover) {
                            options.onHover(event, activeElements, chart);
                        }
                    },
                    ...(options.onClick && { onClick: options.onClick })
                }
            });

            if (options.enableZoom) {
                installRangeInteractions(chart);
            }

            applyChartTheme(chart);
            return chart;
        }

        /**
         * Update chart with smoothing
         */
        function updateChartSmoothing(chart, smoothing, showRawData = true) {
            if (!chart || !chart.data.datasets) return;

            clearHoveredRun(chart, false);
            const originals = chart.data.datasets.filter(d => d._isOriginal);
            if (originals.length === 0) return;
            const originalVisibility = originals.map(d => {
                const datasetIndex = chart.data.datasets.indexOf(d);
                return chart.isDatasetVisible(datasetIndex);
            });
            const newDatasets = [];

            if (smoothing === 0) {
                originals.forEach((d, originalIndex) => {
                    newDatasets.push({
                        label: d._runName,
                        data: d._originalData,
                        borderColor: d._originalColor,
                        backgroundColor: d._originalColor + '20',
                        fill: false,
                        tension: 0.1,
                        pointRadius: d._originalData.length > 100 ? 0 : 2,
                        pointHoverRadius: 4,
                        borderWidth: 2,
                        _originalData: d._originalData,
                        _originalColor: d._originalColor,
                        _runName: d._runName,
                        _runId: d._runId,
                        _isOriginal: true,
                        _runVisible: originalVisibility[originalIndex]
                    });
                });
            } else {
                originals.forEach((d, originalIndex) => {
                    const values = d._originalData.map(p => p.y);
                    const smoothed = applySmoothing(values, smoothing);
                    const runVisible = originalVisibility[originalIndex];

                    if (showRawData) {
                        newDatasets.push({
                            label: d._runName + ' (raw)',
                            data: d._originalData,
                            borderColor: d._originalColor + '4D',
                            backgroundColor: 'transparent',
                            fill: false,
                            tension: 0.1,
                            pointRadius: 0,
                            pointHoverRadius: 3,
                            borderWidth: 1,
                            _originalData: d._originalData,
                            _originalColor: d._originalColor,
                            _runName: d._runName,
                            _runId: d._runId,
                            _isOriginal: false,
                            _isRaw: true,
                            _runVisible: runVisible
                        });
                    }

                    newDatasets.push({
                        label: d._runName,
                        data: smoothed.map((y, i) => ({ x: d._originalData[i].x, y })),
                        borderColor: d._originalColor,
                        backgroundColor: d._originalColor + '20',
                        fill: false,
                        tension: 0.1,
                        pointRadius: d._originalData.length > 100 ? 0 : 2,
                        pointHoverRadius: 4,
                        borderWidth: 2,
                        _originalData: d._originalData,
                        _originalColor: d._originalColor,
                        _runName: d._runName,
                        _runId: d._runId,
                        _isOriginal: true,
                        _runVisible: runVisible
                    });
                });
            }

            chart.data.datasets = newDatasets;
            chart.data.datasets.forEach((dataset, datasetIndex) => {
                chart.setDatasetVisibility(datasetIndex, dataset._runVisible);
                delete dataset._runVisible;
            });
            chart.update('none');
        }

        /**
         * Update chart axes
         */
        function isChartInViewport(chart) {
            const canvas = chart && chart.canvas;
            if (!canvas || !canvas.isConnected) {
                return false;
            }

            const tabContent = canvas.closest('.tab-content');
            const container = canvas.closest('.chart-container');
            if (
                (tabContent && !tabContent.classList.contains('active')) ||
                (container && container.classList.contains('hidden'))
            ) {
                return false;
            }

            const bounds = container || canvas;
            const rect = bounds.getBoundingClientRect();
            return rect.width > 0 &&
                rect.height > 0 &&
                rect.bottom > 0 &&
                rect.right > 0 &&
                rect.top < window.innerHeight &&
                rect.left < window.innerWidth;
        }

        function updateChartAxes(chart, logXAxis, logYAxis) {
            if (!chart) return;
            chart.options.scales.x.type = logXAxis ? 'logarithmic' : 'linear';
            chart.options.scales.y.type = logYAxis ? 'logarithmic' : 'linear';
            if (isChartInViewport(chart)) {
                chart.update();
            } else {
                chart.update('none');
            }
        }

        // ==================== GLOBAL CONTROLS ====================

        function updateGlobalSmoothing() {
            const value = parseFloat(document.getElementById('globalSmoothing').value);
            document.getElementById('globalSmoothingValue').textContent = value.toFixed(2);
            globalSmoothing = value;

            const showRawGroup = document.getElementById('showRawGroup');
            if (showRawGroup) {
                showRawGroup.style.display = value > 0 ? 'flex' : 'none';
            }

            Object.values(chartInstances).forEach(chart => {
                updateChartSmoothing(chart, value, showRaw);
            });
        }

        function toggleShowRaw() {
            showRaw = !showRaw;
            document.getElementById('showRawBtn').classList.toggle('active', showRaw);

            Object.values(chartInstances).forEach(chart => {
                updateChartSmoothing(chart, globalSmoothing, showRaw);
            });
        }

        function toggleLogAxis(axis) {
            if (axis === 'x') {
                logX = !logX;
                document.getElementById('logXBtn').classList.toggle('active', logX);
            } else {
                logY = !logY;
                document.getElementById('logYBtn').classList.toggle('active', logY);
            }

            Object.values(chartInstances).forEach(chart => {
                updateChartAxes(chart, logX, logY);
            });
        }

        function filterMetrics() {
            const searchText = document.getElementById('searchInput').value;
            let regex;

            try {
                regex = new RegExp(searchText, 'i');
            } catch (e) {
                regex = { test: (str) => str.toLowerCase().includes(searchText.toLowerCase()) };
            }

            const selector = '.chart-container, .metric-card';
            document.querySelectorAll(selector).forEach(container => {
                const titleEl = container.querySelector('.chart-title, .metric-title');
                if (titleEl) {
                    const title = titleEl.textContent;
                    const matches = !searchText || regex.test(title);
                    container.classList.toggle('hidden', !matches);
                }
            });

            document.querySelectorAll('.metric-group').forEach(group => {
                const visibleCharts = group.querySelectorAll(selector + ':not(.hidden)');
                group.classList.toggle('hidden', visibleCharts.length === 0 && searchText);
            });
        }

        function closeAllMenus() {
            document.getElementById('textContextMenu').style.display = 'none';
            document.getElementById('chartImageMenu').style.display = 'none';
            textContextMenuOpen = false;
            chartImageMenuOpen = false;
        }

        function showTextContextMenu(event) {
            if (event) event.stopPropagation();
            const wasOpen = textContextMenuOpen;
            closeAllMenus();
            if (!wasOpen) {
                document.getElementById('textContextMenu').style.display = 'block';
                textContextMenuOpen = true;
            }
        }

        function showChartImageMenu(event) {
            if (event) event.stopPropagation();
            const wasOpen = chartImageMenuOpen;
            closeAllMenus();
            if (!wasOpen) {
                document.getElementById('chartImageMenu').style.display = 'block';
                chartImageMenuOpen = true;
            }
        }

        function generateAIContext(action) {
            vscode.postMessage({ command: 'generateAIContext', action: action });
            closeAllMenus();
        }

        // Close menus when clicking outside
        document.addEventListener('click', (e) => {
            if ((textContextMenuOpen || chartImageMenuOpen) && !e.target.closest('.ai-context-btn') && !e.target.closest('.ai-context-menu')) {
                closeAllMenus();
            }
        });

        // ==================== HIGH-LEVERAGE METRIC DETECTION ====================

        const HIGH_LEVERAGE_PATTERNS = [
            /loss/i,
            /\\bacc(uracy)?\\b/i,
            /perplexity/i,
            /\\bppl\\b/i,
            /\\blr\\b/i,
            /learning.?rate/i,
            /grad(ient)?.?norm/i,
            /\\bf1\\b/i,
            /\\bprecision\\b/i,
            /\\brecall\\b/i,
            /\\bbleu\\b/i,
            /\\brouge\\b/i,
            /\\breward\\b/i,
            /\\bmse\\b/i,
            /\\bmae\\b/i,
            /\\brmse\\b/i,
            /\\bauc\\b/i,
            /\\bwer\\b/i,
            /\\bcer\\b/i
        ];

        function isHighLeverageMetric(metricName) {
            return HIGH_LEVERAGE_PATTERNS.some(pattern => pattern.test(metricName));
        }

        // ==================== SINGLE CHART COPY ====================

        async function copySingleChart(type, index) {
            const canvasId = 'chart-' + type + '-' + index;
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;

            // Force-render if not yet lazily initialized
            if (!chartInstances[canvasId]) {
                const metrics = type === 'training' ? trainingMetrics : systemMetrics;
                const metric = metrics[index];
                if (!metric) return;

                const datasets = metric.datasets.map(dataset => ({
                    label: dataset.runName,
                    data: dataset.data.map(d => ({ x: d.step, y: d.value })),
                    borderColor: dataset.color,
                    backgroundColor: dataset.color + '20',
                    fill: false,
                    tension: 0.1,
                    pointRadius: dataset.data.length > 50 ? 0 : 2,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                    _originalData: dataset.data.map(d => ({ x: d.step, y: d.value })),
                    _originalColor: dataset.color,
                    _runName: dataset.runName,
                    _runId: dataset.runId,
                    _isOriginal: true
                }));

                chartInstances[canvasId] = createUnifiedChart(canvas, datasets, metric.metricName, {
                    isModal: false, enableZoom: true
                });
                updateChartSmoothing(chartInstances[canvasId], globalSmoothing, showRaw);
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            }

            const chart = chartInstances[canvasId];
            if (!chart) return;

            const btn = canvas.closest('.chart-container').querySelector('.btn-copy-chart');

            try {
                const dataUrl = chart.toBase64Image('image/png');
                await copyImageToClipboard(dataUrl);

                // Visual feedback
                if (btn) {
                    const orig = btn.textContent;
                    btn.textContent = '\\u2713';
                    setTimeout(() => { btn.textContent = orig; }, 1500);
                }
            } catch (err) {
                const dataUrl = chart.toBase64Image('image/png');
                const base64Data = dataUrl.split(',')[1];
                vscode.postMessage({ command: 'copyChartImageFallback', imageBase64: base64Data });
            }

        }

        // ==================== CHART IMAGE CAPTURE ====================

        async function captureChartImages(action, keyOnly) {
            closeAllMenus();

            // Show status overlay
            const statusEl = document.createElement('div');
            statusEl.className = 'capture-status';
            statusEl.id = 'captureStatus';
            statusEl.innerHTML = '<span class="spinner-small"></span> Preparing charts...';
            document.body.appendChild(statusEl);

            try {
                // Temporarily reveal all tab contents so we capture charts from all tabs
                const allTabContents = document.querySelectorAll('.tab-content');
                const originalDisplay = [];
                allTabContents.forEach(tc => {
                    originalDisplay.push(tc.style.display);
                    tc.style.display = 'block';
                });

                // Find all chart canvases that are not hidden by the metric filter
                let allCanvases = Array.from(
                    document.querySelectorAll('canvas[id^="chart-"]')
                ).filter(canvas => {
                    const container = canvas.closest('.chart-container');
                    return container && !container.classList.contains('hidden');
                });

                // If keyOnly, filter to high-leverage training metrics only
                if (keyOnly) {
                    allCanvases = allCanvases.filter(canvas => {
                        // Skip system metrics entirely for key charts
                        if (canvas.dataset.chartType === 'system') return false;
                        const container = canvas.closest('.chart-container');
                        const titleEl = container ? container.querySelector('.chart-title') : null;
                        const title = titleEl ? titleEl.textContent : '';
                        return isHighLeverageMetric(title);
                    });
                }

                if (allCanvases.length === 0) {
                    // Restore tab visibility
                    allTabContents.forEach((tc, i) => { tc.style.display = originalDisplay[i]; });
                    statusEl.remove();
                    const msg = keyOnly
                        ? 'No key training metrics found (loss, accuracy, lr, etc). Try "Copy All Charts" instead.'
                        : 'No visible charts to capture. Check your filter or select some runs.';
                    vscode.postMessage({ command: 'showWarning', message: msg });
                    return;
                }

                // Force-render any charts that haven't been lazily initialized yet
                for (let i = 0; i < allCanvases.length; i++) {
                    const canvas = allCanvases[i];
                    const canvasId = canvas.id;

                    if (!chartInstances[canvasId]) {
                        const type = canvas.dataset.chartType;
                        const index = parseInt(canvas.dataset.chartIndex);
                        const metrics = type === 'training' ? trainingMetrics : systemMetrics;
                        const metric = metrics[index];

                        if (metric) {
                            const datasets = metric.datasets.map(dataset => ({
                                label: dataset.runName,
                                data: dataset.data.map(d => ({ x: d.step, y: d.value })),
                                borderColor: dataset.color,
                                backgroundColor: dataset.color + '20',
                                fill: false,
                                tension: 0.1,
                                pointRadius: dataset.data.length > 50 ? 0 : 2,
                                pointHoverRadius: 4,
                                borderWidth: 2,
                                _originalData: dataset.data.map(d => ({ x: d.step, y: d.value })),
                                _originalColor: dataset.color,
                                _runName: dataset.runName,
                                _runId: dataset.runId,
                                _isOriginal: true
                            }));

                            chartInstances[canvasId] = createUnifiedChart(
                                canvas, datasets, metric.metricName,
                                { isModal: false, enableZoom: true }
                            );
                            updateChartSmoothing(chartInstances[canvasId], globalSmoothing, showRaw);
                        }
                    }

                    statusEl.innerHTML = '<span class="spinner-small"></span> Rendering charts... ' + (i + 1) + '/' + allCanvases.length;
                }

                // Wait for Chart.js to finish rendering
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

                statusEl.innerHTML = '<span class="spinner-small"></span> Compositing image...';

                // Capture each chart image
                const chartImages = [];
                for (const canvas of allCanvases) {
                    const canvasId = canvas.id;
                    const chart = chartInstances[canvasId];
                    if (!chart) continue;

                    const container = canvas.closest('.chart-container');
                    const titleEl = container ? container.querySelector('.chart-title') : null;
                    const title = titleEl ? titleEl.textContent : canvasId;

                    const imageDataUrl = chart.toBase64Image('image/png');
                    chartImages.push({ title, imageDataUrl });
                }

                // Restore tab visibility
                allTabContents.forEach((tc, i) => { tc.style.display = originalDisplay[i]; });

                if (chartImages.length === 0) {
                    statusEl.remove();
                    vscode.postMessage({ command: 'showWarning', message: 'No chart images could be captured.' });
                    return;
                }

                // Composite into a grid image
                const compositeDataUrl = await compositeChartGrid(chartImages);

                if (action === 'copy') {
                    await copyImageToClipboard(compositeDataUrl);
                    statusEl.innerHTML = '&#10003; Copied ' + chartImages.length + ' chart(s) to clipboard!';
                } else if (action === 'save') {
                    const base64Data = compositeDataUrl.split(',')[1];
                    vscode.postMessage({
                        command: 'saveChartImage',
                        imageBase64: base64Data,
                        chartCount: chartImages.length
                    });
                    statusEl.innerHTML = '&#10003; Saving ' + chartImages.length + ' chart(s)...';
                }

                setTimeout(() => {
                    const el = document.getElementById('captureStatus');
                    if (el) el.remove();
                }, 2000);

            } catch (error) {
                statusEl.innerHTML = '&#10007; Failed: ' + (error.message || String(error));
                setTimeout(() => statusEl.remove(), 3000);
            }
        }

        async function compositeChartGrid(chartImages) {
            const COLS = Math.min(3, chartImages.length);
            const ROWS = Math.ceil(chartImages.length / COLS);
            const CELL_WIDTH = 600;
            const CELL_HEIGHT = 400;
            const TITLE_HEIGHT = 30;
            const PADDING = 20;
            const MARGIN = 30;

            const totalWidth = MARGIN * 2 + COLS * CELL_WIDTH + Math.max(0, COLS - 1) * PADDING;
            const totalHeight = MARGIN * 2 + ROWS * (CELL_HEIGHT + TITLE_HEIGHT) + Math.max(0, ROWS - 1) * PADDING;

            const offscreen = document.createElement('canvas');
            offscreen.width = totalWidth;
            offscreen.height = totalHeight;
            const ctx = offscreen.getContext('2d');

            // Match VS Code theme
            const bgColor = getComputedStyle(document.body).backgroundColor || '#1e1e1e';
            const fgColor = getComputedStyle(document.body).color || '#d4d4d4';
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, totalWidth, totalHeight);

            // Load all chart images
            const images = await Promise.all(
                chartImages.map(item => {
                    return new Promise((resolve, reject) => {
                        const img = new Image();
                        img.onload = () => resolve({ img, title: item.title });
                        img.onerror = reject;
                        img.src = item.imageDataUrl;
                    });
                })
            );

            // Draw each chart in grid
            for (let i = 0; i < images.length; i++) {
                const { img, title } = images[i];
                const col = i % COLS;
                const row = Math.floor(i / COLS);

                const x = MARGIN + col * (CELL_WIDTH + PADDING);
                const y = MARGIN + row * (CELL_HEIGHT + TITLE_HEIGHT + PADDING);

                // Draw title
                ctx.fillStyle = fgColor;
                ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                ctx.textBaseline = 'top';
                ctx.fillText(title, x, y);

                // Draw chart image
                ctx.drawImage(img, x, y + TITLE_HEIGHT, CELL_WIDTH, CELL_HEIGHT);
            }

            return offscreen.toDataURL('image/png');
        }

        async function copyImageToClipboard(dataUrl) {
            const response = await fetch(dataUrl);
            const blob = await response.blob();

            try {
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]);
            } catch (err) {
                // Fallback: send to extension host for temp file
                const base64Data = dataUrl.split(',')[1];
                vscode.postMessage({
                    command: 'copyChartImageFallback',
                    imageBase64: base64Data
                });
                throw new Error('Clipboard image copy not supported. Image saved to temp file instead.');
            }
        }

        // ==================== MODAL CONTROLS ====================

        function updateModalSmoothing() {
            const value = parseFloat(document.getElementById('modalSmoothing').value);
            document.getElementById('modalSmoothingValue').textContent = value.toFixed(2);
            document.getElementById('modalShowRawGroup').style.display =
                value > 0 ? 'flex' : 'none';
            updateChartSmoothing(modalChart, value, modalShowRaw);
        }

        function toggleModalShowRaw() {
            modalShowRaw = !modalShowRaw;
            document.getElementById('modalShowRawBtn').classList.toggle('active', modalShowRaw);

            const smoothing = parseFloat(document.getElementById('modalSmoothing').value);
            updateChartSmoothing(modalChart, smoothing, modalShowRaw);
        }

        function toggleModalLogAxis(axis) {
            if (axis === 'x') {
                modalLogX = !modalLogX;
                document.getElementById('modalLogXBtn').classList.toggle('active', modalLogX);
            } else {
                modalLogY = !modalLogY;
                document.getElementById('modalLogYBtn').classList.toggle('active', modalLogY);
            }

            updateChartAxes(modalChart, modalLogX, modalLogY);
        }

        function closeFullscreen() {
            document.getElementById('fullscreenModal').classList.remove('active');
            document.body.classList.remove('modal-open');
            if (modalChart) {
                modalChart.destroy();
                modalChart = null;
            }
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeFullscreen();
        });

        // Tab switching
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const targetId = tab.dataset.tab || tab.getAttribute('data-tab');

                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const target = document.getElementById(targetId);
                if (target) target.classList.add('active');
            });
        });
    `;
}

/**
 * Returns the controls bar HTML
 */
export function getControlsBarHtml(leadingControlsHtml: string = ''): string {
    return `
        <div class="controls-bar">
            ${leadingControlsHtml}
            <div class="control-group">
                <label for="searchInput">Search:</label>
                <input type="text" id="searchInput" placeholder="Filter metrics (regex)..." oninput="filterMetrics()">
            </div>
            <div class="control-group smoothing-control">
                <label for="globalSmoothing">Smoothing:</label>
                <input type="range" id="globalSmoothing" min="0" max="0.99" step="0.01" value="0" oninput="updateGlobalSmoothing()">
                <span class="smoothing-value" id="globalSmoothingValue">0.00</span>
            </div>
            <div class="control-group" id="showRawGroup" style="display: none;">
                <button class="toggle-btn active" id="showRawBtn" onclick="toggleShowRaw()">Show Raw</button>
            </div>
            <div class="control-group">
                <label>Axes:</label>
                <div class="axis-toggles">
                    <button class="toggle-btn" id="logXBtn" onclick="toggleLogAxis('x')">Log X</button>
                    <button class="toggle-btn" id="logYBtn" onclick="toggleLogAxis('y')">Log Y</button>
                </div>
            </div>
            <div class="control-group" style="margin-left: auto; gap: 8px;">
                <div style="position: relative; display: inline-block;">
                    <button class="ai-context-btn" onclick="showTextContextMenu(event)">
                        🤖 Copy Text Context ▼
                    </button>
                    <div class="ai-context-menu" id="textContextMenu" style="display:none">
                        <button onclick="generateAIContext('copy')">Copy to Clipboard</button>
                        <button onclick="generateAIContext('save')">Save to File...</button>
                    </div>
                </div>
                <div style="position: relative; display: inline-block;">
                    <button class="ai-context-btn" onclick="showChartImageMenu(event)">
                        📊 Copy Chart Images ▼
                    </button>
                    <div class="ai-context-menu" id="chartImageMenu" style="display:none">
                        <button onclick="captureChartImages('copy', true)">Copy Key Charts</button>
                        <button onclick="captureChartImages('copy', false)">Copy All Charts</button>
                        <button onclick="captureChartImages('save')">Save as PNG...</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Returns the fullscreen modal HTML
 */
export function getModalHtml(leadingControlsHtml: string = ''): string {
    return `
        <div id="fullscreenModal" class="modal">
            <div class="modal-header">
                <div class="modal-title" id="modalTitle"></div>
                <div class="modal-controls">
                    ${leadingControlsHtml}
                    <div class="smoothing-control">
                        <label for="modalSmoothing">Smoothing:</label>
                        <input type="range" id="modalSmoothing" min="0" max="0.99" step="0.01" value="0" oninput="updateModalSmoothing()">
                        <span class="smoothing-value" id="modalSmoothingValue">0.00</span>
                    </div>
                    <div class="control-group" id="modalShowRawGroup" style="display: none;">
                        <button class="toggle-btn active" id="modalShowRawBtn" onclick="toggleModalShowRaw()">Show Raw</button>
                    </div>
                    <div class="axis-toggles">
                        <button class="toggle-btn" id="modalLogXBtn" onclick="toggleModalLogAxis('x')">Log X</button>
                        <button class="toggle-btn" id="modalLogYBtn" onclick="toggleModalLogAxis('y')">Log Y</button>
                    </div>
                    <span class="zoom-hint">Horizontal drag: zoom X + fit Y • Box: zoom X/Y • Shift+drag: pan X/Y • Double-click: reset</span>
                    <button class="modal-close" onclick="closeFullscreen()">&times;</button>
                </div>
            </div>
            <div class="modal-content">
                <canvas id="modalChart" class="modal-chart"></canvas>
            </div>
        </div>
    `;
}
