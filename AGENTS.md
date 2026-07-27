# AGENTS.md

## Project overview

Bread Wandb Viewer is a TypeScript VS Code extension for opening local Weights &
Biases `.wandb` files and comparing multiple training runs. It parses W&B data
offline, renders Chart.js-based webviews, can export run data as AI-oriented
Markdown, and does not collect or transmit telemetry.

## Repository map

- `src/extension.ts`: extension activation, command registration, and custom editor.
- `src/wandbParser.ts`: `.wandb`/protobuf parsing and core run-data types.
- `src/webviewPanel.ts`: single-run webview.
- `src/MultiRunScanner.ts`: recursive run discovery, metadata reads, and file watching.
- `src/MultiRunManager.ts`: multi-run selection, caching, colors, and merged metrics.
- `src/MultiRunViewerPanel.ts`: multi-run webview and host/webview message handling.
- `src/chartTemplate.ts`: shared chart HTML, CSS, and browser-side JavaScript.
- `src/aiContext/`: configuration comparison, metric summaries, and Markdown export.
- `src/wandb.proto`: W&B record schema.
- `media/`: extension artwork and README assets.
- `out/`: generated JavaScript; do not edit it directly.

## Setup and validation

Use the package scripts from the repository root:

```bash
npm install
npm run compile
node test-ai-context.js
```

`test-ai-context.js` imports compiled files from `out/`, so compile before running it.
There is no automated VS Code integration-test suite. For UI or parser changes,
also launch the Extension Development Host with `F5` and exercise the affected
single-run or multi-run workflow with representative `.wandb` files.

TypeScript compilation does not remove obsolete files from `out/`. When deleting or
moving a source module, ensure its stale compiled JavaScript and source map are not
left in a packaged build; clean generated output and recompile rather than editing
generated files by hand.

`npm run lint` exists, but verify that ESLint and its configuration are available
before relying on it; they are not currently declared in this package's development
dependencies.

## Implementation conventions

- Keep TypeScript compatible with the strict settings in `tsconfig.json` and with
  the VS Code engine declared in `package.json`.
- Follow the existing style: four-space indentation, single quotes, semicolons,
  explicit exported types, and descriptive camelCase names.
- Keep extension-host code and webview code separate. Data crosses the boundary via
  `webview.postMessage`/`onDidReceiveMessage`; validate message fields before using
  them as paths, identifiers, or HTML content.
- Give webview actions with transient UI state an explicit host response, preferably
  sent from a `finally` block. Do not rely on assigning `webview.html` to reset a
  button or spinner because unchanged HTML may leave the existing DOM in place.
- For data-only refreshes, update existing webview charts through messages instead
  of replacing `webview.html`; rebuilding the document discards zoom, log-axis,
  smoothing, fullscreen, and other browser-side state.
- Preserve VS Code disposal lifecycles. Register commands, watchers, panels, and
  listeners in the relevant `context.subscriptions` or `_disposables` collection.
- Avoid blocking the extension host during scans and large-file processing. Retain
  the existing quick metadata reads, event coalescing, decimation, lazy rendering,
  and bounded LRU cache unless a change intentionally replaces them.
- A trailing debounce can starve live updates when training writes continuously.
  Throttle/coalesce watcher events, serialize refresh work, pause parsing and
  polling while the panel is hidden, and perform one catch-up scan when visible.
- Treat `.wandb` input as untrusted binary data. Bounds-check record lengths, skip
  malformed records when safe, and provide useful errors instead of crashing the
  extension host.
- Keep parsing offline. Do not introduce a W&B API or CLI dependency unless the
  product requirement explicitly changes.
- When changing protobuf handling, keep `src/wandb.proto` and the programmatically
  constructed record types in `wandbParser.ts`/`MultiRunScanner.ts` consistent.
- Reuse the shared chart helpers in `chartTemplate.ts` for behavior common to the
  single-run and multi-run views rather than duplicating browser-side logic.

## Privacy and security

- Do not add analytics or telemetry without an explicit product requirement and
  corresponding privacy documentation.
- Do not log secrets or raw training data. Error messages must not leak local paths
  or file content.
- Escape or safely serialize all run-derived values inserted into webview HTML or
  JavaScript. Constrain file-opening actions to the intended run directory.

## Change checklist

1. Make the smallest coherent source change; do not edit generated `out/` files.
2. Update `package.json`, commands, activation events, and README documentation
   together when user-facing behavior changes.
3. Run `npm run compile`.
4. For AI-context changes, also run `node test-ai-context.js` and add focused cases
   there when practical.
5. Manually exercise affected VS Code webviews for UI, watcher, parser, or lifecycle
   changes.
6. When producing a VSIX, inspect its file list. It must include `out/extension.js`
   and the `protobufjs` runtime dependencies while excluding `wandb/`, `.env`,
   source maps, local datasets, and other private development artifacts.
7. Do not commit packaged `.vsix` artifacts unless the task is explicitly a release.
