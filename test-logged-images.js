// Parser, local-resource, host-message, and slider regressions. Compile first.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const protobuf = require('protobufjs');
const { parseWandbFile, hasWandbMetricData } = require('./out/wandbParser');
const { isImageMetadataField, readHistoryImages, resolveLoggedImagePath } = require('./out/loggedImages');
const originalLoad = Module._load;
let viewer;
try {
    Module._load = function(name, ...args) {
        return name === 'vscode' ? { Uri: { file: value => ({ fsPath: value }) } } : originalLoad.call(this, name, ...args);
    };
    viewer = require('./out/imageViewer');
} finally { Module._load = originalLoad; }

const item = (key, value) => ({ key, value_json: JSON.stringify(value) });
const image = (filename, caption) => ({ _type: 'image-file', path: 'media/images/' + filename, caption });

class Element {
    constructor() {
        this.children = [];
        this.listeners = {};
        this.value = '0';
        this.style = { setProperty(name, value) { this[name] = value; } };
        this.classList = { contains: () => this.active === true };
    }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; this.textContent = ''; }
    replaceWith(child) { this.replacement = child; }
}

function sliderHarness(data, saved = {}) {
    const ids = ['images', 'imageMetric', 'imageStep', 'imageStepLabel', 'imageViewerGallery', 'imageViewerToolbar',
        'imageViewerEmpty', 'imagePrevious', 'imageNext', 'imageRetry', 'imageLoadStatus', 'imageViewerControls'];
    const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
    const tab = new Element();
    tab.dataset = { tab: 'images' };
    const messages = [];
    const decodes = [];
    let state = { activeTab: 'training', unrelated: 'preserved', imageViewer: saved };
    let receive;
    const context = vm.createContext({
        document: { getElementById: id => elements[id], querySelector: () => null, createElement: tag => {
            const element = new Element();
            if (tag === 'img') element.decode = () => new Promise((resolve, reject) => decodes.push({ element, resolve, reject }));
            return element;
        }, querySelectorAll: () => [tab] },
        window: { addEventListener: (event, callback) => { if (event === 'message') receive = callback; } },
        vscode: { getState: () => state, setState: value => { state = value; }, postMessage: value => messages.push(value) },
        queueMicrotask: callback => callback()
    });
    vm.runInContext(viewer.getImageViewerScript(data), context);
    return { elements, messages, decodes, state: () => state, receive: message => receive({ data: message }), open: () => {
        elements.images.active = true;
        tab.listeners.click();
    } };
}

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wandb-images-test-'));
    try {
        const media = path.join(root, 'files', 'media', 'images');
        fs.mkdirSync(media, { recursive: true });
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT+8AAAAASUVORK5CYII=', 'base64');
        fs.writeFileSync(path.join(media, 'one.png'), png);
        fs.mkdirSync(path.join(media, 'validation'), { recursive: true });
        const nestedFilename = 'validation/retrieval_99_0123456789abcdef0123.png';
        fs.writeFileSync(path.join(media, nestedFilename), png);
        const rows = [
            [item('_step', 20), item('_timestamp', 1700000000), item('prediction', image('one.png', '<script>caption</script>')), item('loss', 0.4)],
            [item('_step', 0), item('prediction', image('one.png')), item('loss', 0.8)],
            [item('_step', 10), { nested_key: ['samples', '_type'], value_json: '"images/separated"' },
                { nested_key: ['samples', 'filenames'], value_json: '["media/images/one.png","media/images/missing.png"]' },
                { nested_key: ['samples', 'captions'], value_json: '["one","two"]' },
                { nested_key: ['samples', 'width'], value_json: '1' }],
            [item('_step', 30), item('nested', { validation: image('one.png') })],
            [item('_step', 40), item('samples', [image('one.png'), image('missing.png')])],
            [item('_step', 50), item('__proto__', image('one.png'))],
            [item('_step', 60), item('artifact', { _type: 'image-file', artifact_path: 'wandb-artifact://remote/image.png' })]
        ];
        const record = new protobuf.Root().loadSync(path.join(__dirname, 'src/wandb.proto'), { keepCase: true })
            .lookupType('wandb_internal.Record');
        const chunks = [Buffer.from(':W&B\x00\x00\x00')];
        rows.forEach(items => {
            const payload = Buffer.from(record.encode(record.create({ history: { item: items, step: { num: JSON.parse(items[0].value_json) } } })).finish());
            const header = Buffer.alloc(7);
            header.writeUInt32LE(1, 0);
            header.writeUInt16LE(payload.length, 4);
            header[6] = 1;
            chunks.push(header, payload);
        });
        const log = path.join(root, 'run-images.wandb');
        fs.writeFileSync(log, Buffer.concat(chunks));
        const parsed = parseWandbFile(log);
        assert.deepEqual(parsed.images.prediction.map(frame => frame.step), [0, 20]);
        assert.equal(parsed.images.prediction[1].timestamp, 1700000000);
        assert.equal(parsed.images.samples[0].images[1].caption, 'two');
        assert.equal(parsed.images.samples[1].images.length, 2);
        assert.equal(parsed.images['nested/validation'][0].step, 30);
        assert.equal(parsed.images.__proto__[0].step, 50);
        assert.equal(parsed.images.artifact[0].images[0].path, '');
        assert.equal(parsed.metrics.loss[1].value, 0.4);
        assert.equal(parsed.metrics['samples/width'], undefined);
        const imageOnlyLog = path.join(root, 'run-image-only.wandb');
        const imageOnlyChunks = [chunks[0]];
        for (const step of [0, 1]) {
            const payload = Buffer.from(record.encode(record.create({ history: { step: { num: step }, item: [
                item('_step', step), { nested_key: ['samples', '_type'], value_json: '"image-file"' },
                { nested_key: ['samples', 'path'], value_json: '"media/images/one.png"' },
                { nested_key: ['samples', 'width'], value_json: '1' }
            ] } })).finish());
            const header = Buffer.alloc(7);
            header.writeUInt32LE(1, 0);
            header.writeUInt16LE(payload.length, 4);
            header[6] = 1;
            imageOnlyChunks.push(header, payload);
        }
        fs.writeFileSync(imageOnlyLog, Buffer.concat(imageOnlyChunks));
        assert.deepEqual(parseWandbFile(imageOnlyLog).metrics, {});
        assert.equal(await hasWandbMetricData(imageOnlyLog), false, 'image dimensions are not training metrics');
        const retrievalMetric = 'validation/retrieval/mrr_small_5_query_10';
        const sharedPrefixLog = path.join(root, 'run-shared-prefix.wandb');
        const sharedPrefixChunks = [chunks[0]];
        for (const step of [0, 1, 2]) {
            const items = [item('_step', step),
                item('validation/retrieval/mrr_small_5_query_10', 0.5 + step / 10),
                { nested_key: ['validation', 'retrieval', 'recall'], value_json: '0.75' },
                item('validation/retrieval/width/score', 0.25)];
            if (step === 0) items.push(item('validation/retrieval', image('one.png')));
            else items.push(
                { nested_key: ['validation/retrieval', '_type'], value_json: '"image-file"' },
                { nested_key: ['validation/retrieval', 'path'], value_json: '"media/images/one.png"' });
            items.push(item('validation/retrieval/width', 1), item('validation/retrieval/count', 1),
                item('validation/retrieval/boxes/predictions/box_data/0/score', 0.9));
            const payload = Buffer.from(record.encode(record.create({ history: { step: { num: step }, item: items } })).finish());
            const header = Buffer.alloc(7);
            header.writeUInt32LE(1, 0);
            header.writeUInt16LE(payload.length, 4);
            header[6] = 1;
            sharedPrefixChunks.push(header, payload);
        }
        fs.writeFileSync(sharedPrefixLog, Buffer.concat(sharedPrefixChunks));
        const sharedPrefixData = parseWandbFile(sharedPrefixLog);
        assert.deepEqual(sharedPrefixData.metrics[retrievalMetric].map(point => point.value), [0.5, 0.6, 0.7]);
        assert.equal(sharedPrefixData.metrics['validation/retrieval/recall'].length, 3);
        assert.equal(sharedPrefixData.metrics['validation/retrieval/width/score'].length, 3);
        assert.equal(sharedPrefixData.images['validation/retrieval'].length, 3);
        assert.equal(sharedPrefixData.metrics['validation/retrieval/width'], undefined);
        assert.equal(sharedPrefixData.metrics['validation/retrieval/count'], undefined);
        assert.equal(sharedPrefixData.metrics['validation/retrieval/boxes/predictions/box_data/0/score'], undefined);
        assert.equal(await hasWandbMetricData(sharedPrefixLog), true, 'scalar metrics beneath an image prefix classify the run as populated');
        const mediaKeys = new Set(['validation/retrieval']);
        assert.equal(isImageMetadataField(retrievalMetric, mediaKeys), false);
        assert.equal(isImageMetadataField('validation/retrieval/count/score', mediaKeys), false);
        assert.equal(isImageMetadataField('validation/retrieval/filenames', mediaKeys), true);
        assert.equal(isImageMetadataField('validation/retrieval/masks/class/height', mediaKeys), true);
        assert.equal(readHistoryImages([item('bad', null), { key: 'broken', value_json: '{' }], NaN).frames.size, 0);
        assert.equal(readHistoryImages([item('x', image('one.png'))], 3).frames.get('x').step, 3);
        assert.equal(readHistoryImages([item('batch', { _type: 'images/separated', filenames: Array(200).fill('media/images/one.png') })], 3).frames.get('batch').images.length, 108);

        assert.equal(await resolveLoggedImagePath(root, 'media/images/one.png'), path.join(media, 'one.png'));
        assert.equal(await resolveLoggedImagePath(root, 'files/media/images/one.png'), path.join(media, 'one.png'));
        const latestRun = path.join(root, 'latest-run');
        fs.symlinkSync(root, latestRun);
        const nestedReference = 'media/images/' + nestedFilename;
        const nestedThroughAlias = await resolveLoggedImagePath(latestRun, nestedReference);
        assert.equal(nestedThroughAlias, path.join(latestRun, 'files', nestedReference), 'latest-run alias must match webview resource roots');
        assert.equal(fs.realpathSync(nestedThroughAlias), path.join(media, nestedFilename));
        for (const unsafe of ['../secret.png', '/tmp/secret.png', 'https://example.com/image.png', 'media/images/../../../secret.png',
            'media/images/secret.svg', 'media/images/one.png?query', 'media/images/one.png\0', 'media/images/..\\secret.png']) {
            assert.equal(await resolveLoggedImagePath(root, unsafe), undefined);
        }
        assert.equal(await resolveLoggedImagePath(root, 'media/images/missing.png'), undefined);
        const outside = path.join(root, 'private.png');
        fs.writeFileSync(outside, png);
        fs.symlinkSync(outside, path.join(media, 'escape.png'));
        assert.equal(await resolveLoggedImagePath(root, 'media/images/escape.png'), undefined);
        assert.equal(await resolveLoggedImagePath(latestRun, 'media/images/escape.png'), undefined);
        const otherRun = path.join(root, 'other-run');
        fs.mkdirSync(path.join(otherRun, 'files', 'media'), { recursive: true });
        fs.symlinkSync(media, path.join(otherRun, 'files', 'media', 'images'));
        assert.equal(await resolveLoggedImagePath(otherRun, 'media/images/one.png'), undefined);

        const runs = [{ runId: 'one', runName: '<img onerror=alert(1)>', runDir: root, images: parsed.images }];
        const data = viewer.getImageViewerData(runs);
        assert.equal(JSON.stringify(data).includes('media/images'), false);
        assert.equal(JSON.stringify(data).includes(root), false);
        new vm.Script(viewer.getImageViewerScript(data));
        assert.equal(viewer.getImageViewerScript(data).includes('<img onerror'), false);
        let receive;
        const replies = [];
        const webview = { options: { enableScripts: true }, onDidReceiveMessage: listener => {
            receive = listener; return { dispose() {} };
        }, asWebviewUri: uri => ({ toString: () => 'safe-resource:' + path.basename(uri.fsPath) }), postMessage: message => replies.push(message) };
        viewer.registerImageViewer(webview, () => runs);
        viewer.setImageResourceRoots(webview, [root, root]);
        assert.equal(webview.options.enableScripts, true);
        assert.equal(webview.options.localResourceRoots.length, 2);
        const aliasRuns = [{ ...runs[0], runDir: latestRun, images: { 'validation/retrieval': [
            { step: 100, images: [{ path: nestedReference }] }
        ] } }];
        const aliasReplies = [];
        const aliasWebview = { ...webview, postMessage: message => aliasReplies.push(message), asWebviewUri: uri => {
            assert.equal(uri.fsPath.startsWith(path.join(latestRun, 'files', 'media', 'images') + path.sep), true,
                'image URI must stay under its configured resource root');
            return { toString: () => 'safe-resource:nested.png' };
        } };
        viewer.setImageResourceRoots(aliasWebview, [latestRun]);
        assert.equal(aliasWebview.options.localResourceRoots[0].fsPath, path.join(latestRun, 'files', 'media', 'images'));
        viewer.registerImageViewer(aliasWebview, () => aliasRuns);
        await receive({ command: 'loadLoggedImages', sessionId: 'alias', requestId: 1, runId: 'one', metric: 'validation/retrieval', frameIndex: 0 });
        assert.equal(aliasReplies[0].images[0].src, 'safe-resource:nested.png');
        viewer.registerImageViewer(webview, () => runs);
        const request = { command: 'loadLoggedImages', sessionId: 'test', requestId: 1, runId: 'one', metric: 'samples', frameIndex: 0 };
        await receive(request);
        assert.equal(replies[0].images[0].src, 'safe-resource:one.png');
        assert.equal(replies[0].images[1].src, undefined);
        await receive({ ...request, requestId: 2, runId: 'unknown' });
        assert.deepEqual(replies[1].images, []);
        await receive({ ...request, requestId: 3, metric: 'constructor' });
        assert.deepEqual(replies[2].images, []);
        await receive({ ...request, frameIndex: -1 });
        assert.equal(replies.length, 3);
        assert.equal(JSON.stringify(replies).includes(root), false);

        const history = steps => ({ prediction: steps.map(step => ({ step, images: [{ path: 'media/images/one.png' }] })) });
        const uiRuns = steps => viewer.getImageViewerData([
            { ...runs[0], runName: 'First', images: history(steps) },
            { ...runs[0], runId: 'two', runName: 'Second', images: history([5, 15]) }
        ]);
        const ui = sliderHarness(uiRuns([0, 10, 20]));
        assert.equal(ui.messages.length, 0, 'inactive tab does not load media');
        ui.open();
        assert.equal(ui.elements.imageStepLabel.textContent, '20');
        assert.equal(ui.messages.at(-2).frameIndex, 2);
        assert.equal(ui.messages.at(-1).frameIndex, 1, 'second run holds step 15 at step 20');
        const stale = ui.messages.at(-2);
        const retainedSection = ui.elements.imageViewerGallery.children[0];
        ui.elements.imageStep.value = '0';
        ui.elements.imageStep.listeners.input();
        assert.equal(ui.elements.imageStepLabel.textContent, '0');
        assert.equal(ui.elements.imageViewerGallery.children[0], retainedSection, 'step changes retain the current gallery');
        const current = ui.messages.at(-1);
        await ui.receive({ command: 'loggedImagesLoaded', sessionId: stale.sessionId, requestId: stale.requestId, images: [{ src: 'stale' }] });
        const grid = ui.elements.imageViewerGallery.children[0].children[2];
        assert.equal(grid.textContent, 'Loading images…', 'stale responses cannot overwrite the selected step');
        await ui.receive({ command: 'loggedImagesLoaded', sessionId: 'old-document', requestId: current.requestId, images: [{ src: 'stale' }] });
        assert.equal(grid.textContent, 'Loading images…');
        await ui.receive({ command: 'loggedImagesLoaded', sessionId: current.sessionId, requestId: current.requestId, images: [{ caption: '<script>caption</script>' }] });
        const updatedGrid = ui.elements.imageViewerGallery.children[0].children[2];
        assert.equal(updatedGrid.children[0].children[1].textContent, '<script>caption</script>');
        assert.equal(updatedGrid.children[0].children[0].className, 'image-viewer-missing');
        assert.equal(ui.elements.imageViewerGallery.children[1].children[1].textContent, 'No image logged at or before this step.');
        await ui.receive({ imageRuns: uiRuns([0, 10, 20, 30]) });
        assert.equal(ui.elements.imageStepLabel.textContent, '0', 'historical step survives updates');
        ui.elements.imageStep.value = ui.elements.imageStep.max;
        ui.elements.imageStep.listeners.input();
        await ui.receive({ imageRuns: uiRuns([0, 10, 20, 30, 40]) });
        assert.equal(ui.elements.imageStepLabel.textContent, '40', 'latest step follows live updates');
        assert.equal(ui.state().unrelated, 'preserved');
        assert.equal(ui.state().imageViewer.followLatest, true);
        const restored = sliderHarness(uiRuns([0, 10, 20]), { metric: 'prediction', step: 10, followLatest: false });
        restored.open();
        assert.equal(restored.elements.imageStepLabel.textContent, '10');
        await ui.receive({ imageRuns: [] });
        assert.equal(ui.elements.imageViewerToolbar.hidden, true);
        assert.equal(ui.elements.imageViewerEmpty.hidden, false);
        assert.equal(ui.elements.imageViewerGallery.children.length, 0);

        const buffered = sliderHarness(uiRuns([0, 10, 20]));
        buffered.open();
        const reply = (request, src) => buffered.receive({ command: 'loggedImagesLoaded', sessionId: request.sessionId,
            requestId: request.requestId, images: [{ src }] });
        const firstLoad = reply(buffered.messages[0], 'initial-first');
        const secondLoad = reply(buffered.messages[1], 'initial-second');
        buffered.decodes[0].resolve();
        await firstLoad;
        assert.equal(buffered.elements.imageLoadStatus.textContent, 'Loading step 20…');
        buffered.decodes[1].resolve();
        await secondLoad;
        const displayed = buffered.elements.imageViewerGallery.children[0];
        assert.equal(displayed.children[2].children[0].children[0].src, 'initial-first');
        assert.equal(buffered.elements.imageLoadStatus.textContent, '');
        buffered.elements.imageStep.value = '2'; // Union step 10.
        buffered.elements.imageStep.listeners.input();
        const nextFirst = reply(buffered.messages.at(-2), 'next-first');
        const nextSecond = reply(buffered.messages.at(-1), 'next-second');
        assert.equal(buffered.elements.imageViewerGallery.children[0], displayed, 'old images stay while new pixels decode');
        buffered.decodes[2].resolve();
        await nextFirst;
        assert.equal(buffered.elements.imageViewerGallery.children[0], displayed, 'comparison swaps only after every run is ready');
        buffered.decodes[3].resolve();
        await nextSecond;
        const nextDisplayed = buffered.elements.imageViewerGallery.children[0];
        assert.equal(nextDisplayed.children[2].children[0].children[0].src, 'next-first');
        assert.equal(buffered.elements.imageViewerGallery.children[1].children[2].children[0].children[0].src, 'next-second');

        buffered.elements.imageStep.value = '4';
        buffered.elements.imageStep.listeners.input();
        const obsoleteLoad = reply(buffered.messages.at(-2), 'obsolete');
        buffered.elements.imageStep.value = '0';
        buffered.elements.imageStep.listeners.input();
        const latestLoad = reply(buffered.messages.at(-1), 'latest');
        buffered.decodes[4].resolve();
        await obsoleteLoad;
        assert.equal(buffered.elements.imageViewerGallery.children[0], nextDisplayed, 'stale decodes cannot change the visible gallery');
        buffered.decodes[5].resolve();
        await latestLoad;
        assert.equal(buffered.elements.imageViewerGallery.children[0].children[2].children[0].children[0].src, 'latest');
        buffered.elements.imageNext.listeners.click();
        const brokenLoad = reply(buffered.messages.at(-2), 'broken');
        const removedLoad = reply(buffered.messages.at(-1), 'removed');
        buffered.decodes[6].reject(new Error('Image decode failed'));
        await brokenLoad;
        buffered.decodes[7].resolve();
        await removedLoad;
        assert.equal(buffered.elements.imageViewerGallery.children[0].children[2].children[0].children[0].className, 'image-viewer-missing');
        assert.equal(buffered.elements.imageLoadStatus.textContent, '', 'decode failures finish with a placeholder');
        buffered.elements.imageNext.listeners.click();
        const abandonedLoad = reply(buffered.messages.at(-2), 'abandoned');
        await buffered.receive({ imageRuns: [] });
        buffered.decodes[8].resolve();
        await abandonedLoad;
        assert.equal(buffered.elements.imageViewerGallery.children.length, 0, 'deselection invalidates pending decodes');
        console.log('Logged image parsing, local path safety, host requests, and step-slider lifecycle passed.');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
