# AGENTS.md

## Project overview

Bread Wandb Viewer is a TypeScript VS Code extension for opening local Weights &
Biases `.wandb` files and comparing multiple training runs. It parses W&B data
locally without the W&B API or CLI, renders Chart.js-based webviews, can export run
data as AI-oriented Markdown, and does not collect or transmit telemetry. Run
parsing is offline, but the webviews currently load Chart.js and its zoom plugin
from jsDelivr. The only run-data upload path is an explicitly confirmed Sync
action that invokes the user's locally installed `wandb sync` CLI.

## Repository map

- `src/extension.ts`: extension activation, command registration, custom editor,
  and initial/fullscreen datasets for that editor.
- `src/wandbParser.ts`: `.wandb`/protobuf parsing and core run-data types.
- `src/webviewPanel.ts`: single-run webview.
- `src/MultiRunScanner.ts`: recursive run discovery, metadata and local sync-status
  reads, and file watching.
- `src/MultiRunManager.ts`: multi-run selection, caching, colors, and merged metrics.
- `src/MultiRunViewerPanel.ts`: multi-run webview, initial/fullscreen dataset
  construction, and host/webview message handling.
- `src/chartTemplate.ts`: shared chart HTML, CSS, browser-side behavior, and dataset
  rebuilding for smoothing and capture flows.
- `src/runColors.ts`: configurable run palettes and deterministic run-ID color
  assignment.
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

Some legacy `out/` files are tracked while newer compiled modules are ignored, so
`npm run compile` can leave tracked generated diffs. Package from the freshly
compiled output, but do not stage or commit generated diffs. After packaging, clean
up only generated changes caused by the current work; preserve any pre-existing
worktree changes.

`npm run lint` exists, but verify that ESLint and its configuration are available
before relying on it; they are not currently declared in this package's development
dependencies.

## Local extension installation

After implementing extension behavior changes, package and install a fresh VSIX in
the local VS Code before reporting completion, unless the user explicitly asks not
to install it. Build the VSIX outside the repository so local packages are not
accidentally committed:

```bash
npm run package:vsix -- /tmp/wandb-viewer-local.vsix
code --install-extension /tmp/wandb-viewer-local.vsix --force
```

The packaging script uses `vsce` to create the extension manifest, adds the
`protobufjs` production runtime and its transitive runtime dependencies, removes
TypeScript declarations and source maps, and validates the completed archive. Do
not replace it with a bare `vsce --no-dependencies` package, which cannot run the
parser.

Inspect the package file list before installation as described in the change
checklist. After installation, tell the user to run `Developer: Reload Window`;
installing a VSIX does not replace code already loaded by the current extension
host.

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
- Apply run selection optimistically in the webview, acknowledge the explicit
  selected state from the host, and coalesce rapid changes before parsing. Serialize
  selection refreshes and schedule a follow-up when selection changes during a
  parse; never make each checkbox await a full webview rebuild.
- For data-only refreshes, update existing webview charts through messages instead
  of replacing `webview.html`; rebuilding the document discards zoom, log-axis,
  smoothing, fullscreen, and other browser-side state.
- Treat run-palette changes as style/data refreshes: update sidebar swatches,
  comparison swatches, overview datasets, and fullscreen datasets through a
  webview message without rebuilding the document.
- Keep run-color assignment deterministic and collision-aware. Probe from each
  run's stable palette index and do not reuse a color while an unused entry remains.
- When a full webview rebuild is required for structural changes, preserve the
  existing `vscode.getState()` keys for active tabs, controls, sidebar geometry,
  per-metric zoom ranges, and run visibility. Per-chart state is keyed by chart
  type and metric name rather than transient dataset indices.
- Treat fullscreen restoration as explicit modal state. Persist both the metric
  identity and whether the modal is open, clear both even when no Chart.js instance
  exists, and invalidate deferred modal renders when fullscreen closes.
- Multi-run comparisons are not a singleton. Each independent panel owns its own
  manager, folder set, watcher set, webview state, title, and disposal lifecycle.
  Adding a folder to a panel must rescan all roots so runs from earlier roots are
  not mistaken for deletions.
- Preserve VS Code disposal lifecycles. Register commands, watchers, panels, and
  listeners in the relevant `context.subscriptions` or `_disposables` collection.
- Avoid blocking the extension host during scans and large-file processing. Retain
  the existing quick metadata reads, event coalescing, decimation, lazy rendering,
  and bounded LRU cache unless a change intentionally replaces them.
- A trailing debounce can starve live updates when training writes continuously.
  Throttle/coalesce watcher events, serialize refresh work, pause parsing and
  polling while the panel is hidden, and perform one catch-up scan when visible.
- Do not let a watcher's asynchronous baseline scan absorb file events that arrive
  during initialization. Preserve and replay those paths, and compare both
  modification time and file size when deciding whether parsed run data is stale.
- Treat `.wandb` input as untrusted binary data. Bounds-check record lengths, skip
  malformed records when safe, and provide useful errors instead of crashing the
  extension host.
- Keep parsing offline. Do not introduce a W&B API or CLI dependency unless the
  product requirement explicitly changes. The optional Sync UI is the sole
  exception: validate requested run IDs, require modal confirmation, spawn
  `wandb sync` with an argument array and `shell: false`, and never expose command
  output or local paths in logs or error messages.
- Mirror W&B's local sync markers without network access: `<run>.wandb.synced` is
  synced, `offline-run-*` is unsynced without that marker, and normal `run-*`
  directories are treated as synced. Keep unknown layouts explicitly unknown.
- Keep original run names read-only. Custom display names belong in VS Code
  extension-global storage keyed by run ID; apply them consistently to the sidebar,
  metadata, charts, config comparison, single-run header, and AI-context export.
  Initialize the rename input with the current displayed name; an empty alias
  restores the original name. Never rewrite `.wandb` protobuf logs.
- Cache whether parsed runs contain metric data independently from the bounded
  parsed-data LRU, so confirmed empty runs stay grayed after cache eviction and
  return to unknown when their files change. Only `WandbRunData.metrics` determines
  this status; a run with system metrics but no run/training metric values is empty.
- Treat the running badge as a lightweight activity heuristic, not authoritative
  process state. Base it on recent `.wandb` modification time, update it from file
  watcher metadata, and age it out in the webview without reparsing run files.
- Keep the sidebar's empty-run filter content-aware: it hides only runs confirmed
  empty, never unknown/unparsed runs, persists in webview state, and reapplies when
  a data-only status update arrives.
- Keep the sidebar text filter glob-based and case-insensitive. `*` matches any
  sequence, `?` matches one character, and regex metacharacters are treated
  literally. Preserve substring matching when a pattern has no surrounding `*`.
- Keep the overview chart controls sticky within the actual scrolling container.
  The multi-run wrapper and the shared single-run controls have different parent
  layouts, so audit both when changing toolbar positioning.
- Treat fullscreen state as host-verified before rebuilding a multi-run webview.
  Modal open/close events update the host, and run-selection messages carry the
  current modal state so stale `vscode.getState()` data cannot reopen a closed
  fullscreen chart.
- When changing protobuf handling, keep `src/wandb.proto` and the programmatically
  constructed record types in `wandbParser.ts`/`MultiRunScanner.ts` consistent.
- Reuse the shared chart helpers in `chartTemplate.ts` for behavior common to the
  single-run and multi-run views rather than duplicating browser-side logic.
- Chart datasets are still constructed in several places:
  `MultiRunViewerPanel.ts`, `extension.ts`, `webviewPanel.ts`, and the smoothing,
  copy, and capture paths in `chartTemplate.ts`. When changing dataset defaults,
  audit every constructor and test the initial render as well as rebuilt datasets.
- Treat raw and smoothed datasets as visual variants of one run. Preserve a stable
  run identity across derived datasets, keep their visibility synchronized, expose
  one legend and tooltip concept per run, and keep equivalent overview/fullscreen
  controls behaviorally aligned.
- Preserve run visibility when moving between overview and fullscreen charts.
  Legend double-click isolation must restore the visibility snapshot from before
  isolation, including runs that were already hidden.
- Clicking a sidebar run name focuses that run without changing selection. Persist
  the focused run ID, apply it to every initialized overview/fullscreen chart, apply
  it when lazy charts are created or datasets are rebuilt, and let transient chart
  hover return to the focused styling when the pointer leaves.
- Preserve the current multi-run chart interaction invariants:
  - Run datasets render as unfilled curves (`fill: false`).
  - Plot hover emphasizes the nearest run in the legend and tooltip without
    changing line styling; legend hover may highlight the corresponding line.
    When other runs are dimmed, their point backgrounds and borders must dim with
    their lines. Keep ordinary point markers visually quieter than the curves.
  - Tooltips keep all visible runs, sort entries from highest to lowest Y value,
    and give only the pointer-nearest run a solid swatch and highlighted row.
- Do not conflate lazy chart rendering with lazy run parsing. Charts are already
  initialized when they become visible and that behavior should be retained. Lazy
  parsing/enabling of runs is a separate, currently deferred idea.

## Privacy and security

- Do not add analytics or telemetry without an explicit product requirement and
  corresponding privacy documentation. Viewing and analysis must not upload run
  data; only the confirmed Sync action may hand selected runs to the W&B CLI.
- Do not log secrets or raw training data. Error messages must not leak local paths
  or file content.
- Escape or safely serialize all run-derived values inserted into webview HTML or
  JavaScript. Constrain file-opening actions to the intended run directory.

## Change checklist

1. Make the smallest coherent source change; do not edit generated `out/` files.
2. Update `package.json`, commands, activation events, and README documentation
   together when user-facing behavior changes.
   Keep the declared values for `wandbViewer.defaultRunSort` and
   `wandbViewer.runColorPalette` aligned with the validation in the multi-run
   viewer.
3. Run `npm run compile`.
4. For AI-context changes, also run `node test-ai-context.js` and add focused cases
   there when practical.
5. Manually exercise affected VS Code webviews for UI, watcher, parser, or lifecycle
   changes. For chart changes, check both overview and fullscreen views before and
   after smoothing or raw-data toggles; initial and rebuilt datasets use different
   construction paths.
6. When producing a VSIX, inspect its file list. It must include `out/extension.js`
   and the `protobufjs` runtime dependencies while excluding `wandb/`, `.env`,
   source maps, local datasets, and other private development artifacts.
7. Do not commit packaged `.vsix` artifacts unless the task is explicitly a release.
