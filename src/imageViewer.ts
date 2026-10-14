import * as vscode from 'vscode';
import * as path from 'path';
import { LoggedImageHistory, resolveLoggedImagePath } from './loggedImages';
import { serializeForScript } from './webviewHtml';

export interface ImageViewerRun {
    runId: string;
    runName: string;
    runDir: string;
    images: LoggedImageHistory;
}

export function getImageViewerData(runs: ImageViewerRun[]): object[] {
    return runs.filter(run => Object.keys(run.images).length > 0).map(run => ({
        runId: run.runId,
        runName: run.runName,
        series: Object.entries(run.images).map(([metric, frames]) => ({
            metric,
            frames: frames.map(frame => ({ step: frame.step, timestamp: frame.timestamp }))
        }))
    }));
}

/** Keep resource access limited to local image folders, including added roots. */
export function setImageResourceRoots(webview: vscode.Webview, runDirs: string[], extensionUri?: vscode.Uri): void {
    webview.options = {
        ...webview.options,
        localResourceRoots: [
            ...(extensionUri ? [extensionUri] : []),
            ...Array.from(new Set(runDirs)).flatMap(runDir => [
                vscode.Uri.file(path.join(runDir, 'files', 'media', 'images')),
                vscode.Uri.file(path.join(runDir, 'media', 'images'))
            ])
        ]
    };
}

/** Requests use run/series/frame identities; the browser never supplies a path. */
export function registerImageViewer(
    webview: vscode.Webview,
    getRuns: () => ImageViewerRun[]
): vscode.Disposable {
    return webview.onDidReceiveMessage(async message => {
        if (!message || message.command !== 'loadLoggedImages') return;
        if (!Number.isSafeInteger(message.requestId) || message.requestId < 0 ||
            typeof message.sessionId !== 'string' || message.sessionId.length > 100 ||
            typeof message.runId !== 'string' || message.runId.length > 1024 ||
            typeof message.metric !== 'string' || message.metric.length > 1024 ||
            !Number.isSafeInteger(message.frameIndex) || message.frameIndex < 0) return;
        let images: { src?: string; caption?: string }[] = [];
        try {
            const run = getRuns().find(candidate => candidate.runId === message.runId);
            const frames = run && Object.prototype.hasOwnProperty.call(run.images, message.metric)
                ? run.images[message.metric] : undefined;
            const frame = frames?.[message.frameIndex];
            if (run && frame) {
                images = await Promise.all(frame.images.slice(0, 108).map(async image => {
                    const imagePath = await resolveLoggedImagePath(run.runDir, image.path);
                    return {
                        caption: image.caption,
                        src: imagePath ? webview.asWebviewUri(vscode.Uri.file(imagePath)).toString() : undefined
                    };
                }));
            }
        } catch {
            // Missing media and invalid references produce a generic placeholder.
        } finally {
            await webview.postMessage({ command: 'loggedImagesLoaded', sessionId: message.sessionId, requestId: message.requestId, images });
        }
    });
}

export function getImageViewerStyles(): string {
    return `
        .image-viewer-controls { position: sticky; top: var(--image-viewer-sticky-top, 0px); z-index: 90; background: var(--vscode-editor-background, #1e1e1e); padding: 8px 0; margin: 12px 0; border-bottom: 1px solid var(--vscode-panel-border); }
        .image-viewer-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
        .image-viewer-controls[hidden], .image-viewer-toolbar[hidden], .image-viewer-empty[hidden] { display: none; }
        .image-viewer-toolbar label { display: flex; align-items: center; gap: 8px; }
        .image-viewer-toolbar select, .image-viewer-toolbar button { color: var(--vscode-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-panel-border); padding: 6px; border-radius: 4px; }
        .image-viewer-toolbar select { max-width: 320px; }
        .image-step-control { flex: 1; min-width: 240px; }
        .image-step-control input { flex: 1; min-width: 100px; }
        .image-step-control output { flex: 0 0 var(--image-step-label-width, 4ch); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .image-load-status { min-height: 1.4em; line-height: 1.4; color: var(--vscode-descriptionForeground); font-size: 0.85em; }
        .image-viewer-run { border: 1px solid var(--vscode-panel-border); border-radius: 6px; margin: 16px 0; padding: 12px; }
        .image-viewer-run h3 { margin: 0 0 8px; overflow-wrap: anywhere; }
        .image-frame-label, .image-viewer-empty { color: var(--vscode-descriptionForeground); margin: 8px 0; }
        .image-viewer-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 12px; }
        .image-viewer-grid figure { margin: 0; min-width: 0; }
        .image-viewer-grid img { display: block; width: 100%; height: 320px; object-fit: contain; background: var(--vscode-editor-background); }
        .image-viewer-grid figcaption { padding: 6px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
        .image-viewer-missing { padding: 32px 12px; color: var(--vscode-descriptionForeground); border: 1px dashed var(--vscode-panel-border); }
    `;
}

export function getImageViewerHtml(): string {
    return `<div id="images" class="tab-content">
        <div class="image-viewer-controls" id="imageViewerControls" hidden>
        <div class="image-viewer-toolbar" id="imageViewerToolbar" hidden>
            <label>Image key <select id="imageMetric" aria-label="Logged image key"></select></label>
            <label class="image-step-control">Step <input id="imageStep" type="range" min="0" max="0" value="0" step="1" aria-label="Logged image step"><output id="imageStepLabel" for="imageStep"></output></label>
            <button type="button" id="imagePrevious" aria-label="Previous logged image step">◀</button>
            <button type="button" id="imageNext" aria-label="Next logged image step">▶</button>
            <button type="button" id="imageRetry">Reload images</button>
        </div>
        <div id="imageLoadStatus" class="image-load-status" role="status" aria-live="polite"></div>
        </div>
        <p class="image-viewer-empty" id="imageViewerEmpty">No logged images in the selected runs.</p>
        <div id="imageViewerGallery"></div>
    </div>`;
}

export function getImageViewerScript(data: object[]): string {
    return `
        (() => {
            let runs = ${serializeForScript(data)};
            const metricSelect = document.getElementById('imageMetric');
            const slider = document.getElementById('imageStep');
            const stepLabel = document.getElementById('imageStepLabel');
            const gallery = document.getElementById('imageViewerGallery');
            const toolbar = document.getElementById('imageViewerToolbar');
            const controls = document.getElementById('imageViewerControls');
            const chartToolbar = document.querySelector('.controls-bar-wrapper') || document.querySelector('.controls-bar');
            const empty = document.getElementById('imageViewerEmpty');
            const previous = document.getElementById('imagePrevious');
            const next = document.getElementById('imageNext');
            const loadStatus = document.getElementById('imageLoadStatus');
            const saved = (vscode.getState() || {}).imageViewer || {};
            let metric = saved.metric;
            let selectedStep = saved.step;
            let followLatest = saved.followLatest !== false;
            let steps = [];
            let requestId = 0;
            const sessionId = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
            let generation = 0;
            const pending = new Map();
            function updateStickyPosition() {
                const height = chartToolbar ? chartToolbar.getBoundingClientRect().height : 0;
                controls.style.setProperty('--image-viewer-sticky-top', Math.ceil(height) + 'px');
            }
            if (chartToolbar && typeof ResizeObserver === 'function') {
                new ResizeObserver(updateStickyPosition).observe(chartToolbar);
            }
            window.addEventListener('resize', updateStickyPosition);
            updateStickyPosition();
            function save() {
                vscode.setState({ ...(vscode.getState() || {}), imageViewer: { metric, step: selectedStep, followLatest } });
            }
            function active() { return document.getElementById('images').classList.contains('active'); }
            function rebuild() {
                generation++;
                pending.clear();
                const keys = [...new Set(runs.flatMap(run => run.series.map(series => series.metric)))].sort();
                if (!keys.includes(metric)) metric = keys[0];
                metricSelect.replaceChildren();
                keys.forEach(key => {
                    const option = document.createElement('option');
                    option.value = key;
                    option.textContent = key;
                    metricSelect.appendChild(option);
                });
                metricSelect.value = metric || '';
                steps = [...new Set(runs.flatMap(run => {
                    const series = run.series.find(series => series.metric === metric);
                    return series ? series.frames.map(frame => frame.step) : [];
                }))].sort((a, b) => a - b);
                // Reserve enough counter space for every step before scrubbing.
                stepLabel.style.setProperty('--image-step-label-width', steps.reduce(
                    (width, step) => Math.max(width, String(step).length), 1
                ) + 'ch');
                toolbar.hidden = steps.length === 0;
                controls.hidden = steps.length === 0;
                empty.hidden = steps.length > 0;
                slider.max = String(Math.max(0, steps.length - 1));
                slider.disabled = steps.length < 2;
                let index = steps.findIndex(step => step >= selectedStep);
                if (followLatest || index < 0) index = steps.length - 1;
                slider.value = String(Math.max(0, index));
                selectedStep = steps[Number(slider.value)];
                stepLabel.textContent = selectedStep === undefined ? '' : String(selectedStep);
                previous.disabled = Number(slider.value) === 0;
                next.disabled = Number(slider.value) >= steps.length - 1;
                if (!steps.length) {
                    gallery.replaceChildren();
                    loadStatus.textContent = '';
                }
                if (active()) render();
            }
            function commitRender(state) {
                if (state.generation !== generation || state.remaining !== 0) return;
                gallery.replaceChildren(...state.sections);
                loadStatus.textContent = '';
            }
            function render() {
                generation++;
                pending.clear();
                if (!steps.length) {
                    gallery.replaceChildren();
                    loadStatus.textContent = '';
                    return;
                }
                // Prepare the next gallery without removing the displayed frame.
                const state = { generation, remaining: 0, sections: [] };
                selectedStep = steps[Number(slider.value)];
                stepLabel.textContent = String(selectedStep);
                previous.disabled = Number(slider.value) === 0;
                next.disabled = Number(slider.value) >= steps.length - 1;
                save();
                runs.forEach(run => {
                    const series = run.series.find(series => series.metric === metric);
                    if (!series) return;
                    // Hold the most recently logged frame until this run logs another.
                    let low = 0, high = series.frames.length;
                    while (low < high) {
                        const middle = Math.floor((low + high) / 2);
                        if (series.frames[middle].step <= selectedStep) low = middle + 1;
                        else high = middle;
                    }
                    const index = low - 1;
                    const section = document.createElement('section');
                    section.className = 'image-viewer-run';
                    const heading = document.createElement('h3');
                    heading.textContent = run.runName;
                    section.appendChild(heading);
                    const label = document.createElement('div');
                    label.className = 'image-frame-label';
                    section.appendChild(label);
                    state.sections.push(section);
                    if (index < 0) { label.textContent = 'No image logged at or before this step.'; return; }
                    const frame = series.frames[index];
                    label.textContent = 'Logged at step ' + frame.step;
                    if (Number.isFinite(frame.timestamp)) {
                        const date = new Date(frame.timestamp * 1000);
                        if (!Number.isNaN(date.getTime())) label.textContent += ' · ' + date.toLocaleString();
                    }
                    const grid = document.createElement('div');
                    grid.className = 'image-viewer-grid';
                    grid.textContent = 'Loading images…';
                    section.appendChild(grid);
                    const id = ++requestId;
                    state.remaining++;
                    pending.set(id, { grid, state });
                    vscode.postMessage({ command: 'loadLoggedImages', sessionId, requestId: id, runId: run.runId, metric, frameIndex: index });
                });
                // Show placeholders only when there is no previous frame to keep.
                if (!gallery.children.length) gallery.replaceChildren(...state.sections);
                loadStatus.textContent = state.remaining ? 'Loading step ' + selectedStep + '…' : '';
                commitRender(state);
            }
            slider.addEventListener('input', () => {
                followLatest = Number(slider.value) === steps.length - 1;
                render();
            });
            metricSelect.addEventListener('change', () => { metric = metricSelect.value; rebuild(); });
            previous.addEventListener('click', () => {
                slider.value = String(Math.max(0, Number(slider.value) - 1));
                followLatest = Number(slider.value) === steps.length - 1;
                render();
            });
            next.addEventListener('click', () => {
                slider.value = String(Math.min(steps.length - 1, Number(slider.value) + 1));
                followLatest = Number(slider.value) === steps.length - 1;
                render();
            });
            document.getElementById('imageRetry').addEventListener('click', render);
            document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
                if (tab.dataset.tab === 'images') queueMicrotask(render);
            }));
            window.addEventListener('message', async event => {
                const message = event.data;
                if (!message || typeof message !== 'object') return;
                if (Array.isArray(message.imageRuns)) { runs = message.imageRuns; rebuild(); }
                if (message.command !== 'loggedImagesLoaded' || message.sessionId !== sessionId) return;
                const target = pending.get(message.requestId);
                pending.delete(message.requestId);
                if (!target || target.state.generation !== generation) return;
                const grid = target.grid;
                if (!Array.isArray(message.images) || !message.images.length) {
                    grid.replaceChildren();
                    grid.textContent = 'Image data unavailable. Reload the run and try again.';
                } else {
                    const figures = await Promise.all(message.images.map(async (image, index) => {
                        const figure = document.createElement('figure');
                        const missing = document.createElement('div');
                        missing.className = 'image-viewer-missing';
                        missing.textContent = 'Image unavailable locally. Keep the run’s files/media/images folder alongside its .wandb file.';
                        if (image.src) {
                            const img = document.createElement('img');
                            img.loading = 'eager';
                            img.alt = image.caption || 'Logged image ' + (index + 1);
                            img.src = image.src;
                            try {
                                // Decoding off-screen avoids showing an empty image
                                // while the browser fetches or paints its pixels.
                                await img.decode();
                                figure.appendChild(img);
                            } catch {
                                figure.appendChild(missing);
                            }
                        } else figure.appendChild(missing);
                        if (image.caption) {
                            const caption = document.createElement('figcaption');
                            caption.textContent = image.caption;
                            figure.appendChild(caption);
                        }
                        return figure;
                    }));
                    if (target.state.generation !== generation) return;
                    grid.replaceChildren(...figures);
                }
                target.state.remaining--;
                commitRender(target.state);
            });
            rebuild();
            queueMicrotask(() => { if (active() && !pending.size) render(); });
        })();
    `;
}
