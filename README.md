# Bread Wandb Viewer — Community Fork

[![License](https://img.shields.io/github/license/erikscheurer/Bread-WandB-Viewer)](LICENSE)

> [!IMPORTANT]
> This repository is a community fork of
> [Bread Technologies' original Bread Wandb Viewer](https://github.com/Bread-Technologies/Bread-WandB-Viewer).
> It is not the source repository for the `bread-tech.wandb-viewer` extension on
> the VS Code Marketplace.
>
> This fork is primarily shaped around its maintainer's local experiment workflow
> and does not aim to cover every W&B feature. Issues and pull requests are very
> welcome when another workflow would benefit from broader support.

**Compare ML training runs side-by-side in VS Code - no browser switching, no waiting**

Stop switching to your browser to compare training runs. **Bread Wandb Viewer** brings Weights & Biases visualization directly into VS Code. Compare multiple runs side-by-side with interactive charts, export AI context for Claude Code/Cursor/Codex, and analyze experiments without leaving your editor.

Perfect for machine learning engineers, deep learning researchers, and data scientists who want to stay in their development environment.

## What This Fork Changes

Compared with the upstream code at the point this repository was forked, this
version adds:

- **No telemetry** — the Application Insights integration and telemetry dependency
  have been removed.
- **Reliable live runs** — active `.wandb` files refresh without being starved by
  continuous writes; missed changes are detected by polling; parsing pauses while
  the panel is hidden and catches up when it becomes visible.
- **Run discovery and manual refresh** — newly created runs are found
  periodically or on demand, and displayed runs can be reloaded without rebuilding
  the webview.
- **Responsive run selection** — sidebar checkboxes update immediately while rapid
  changes are coalesced before run parsing and chart rebuilding begin.
- **State-preserving chart updates** — refreshes retain zoom, smoothing, log axes,
  run visibility, active tabs, filters, sidebar size, and fullscreen state.
  Fullscreen charts reopen reliably while keeping legend visibility synchronized
  with the overview. Raw
  and smoothed traces behave as one run. Chart controls remain visible while
  scrolling through long metric lists.
- **Improved chart interaction** — X-range and box zoom, two-axis panning,
  Ctrl+scroll cursor zoom, resizable chart rows, visibility-preserving legend
  isolation, linked run highlighting across lines and point markers, and clearer
  cursor-sorted tooltips.
- **Better run comparison** — side-by-side configuration comparison with search,
  independent run-row and parameter-column sorting, plus glob run filtering and
  sorting by name, creation time, or latest update.
- **Stable, theme-aware visuals** — deterministic configurable run palettes,
  improved light-theme contrast, and unfilled run curves.
- **Multi-folder workspaces** — open independent comparison tabs or add more run
  folders to an existing viewer, with folder-specific tab titles and icons.
- **Shared comparison groups** — save named run sets such as baselines, toggle the
  whole set at once, and continue adjusting member runs individually.
- **Richer run navigation** — full-name and empty-run tooltips, local sync-state
  badges, creation timestamps, likely-running indicators, click-to-highlight run
  names, a persisted **Hide empty** filter, and run-specific context actions.

A run is considered empty when none of its run/training metrics contain values.
System telemetry by itself does not make a run non-empty.

## Multi-Run Comparison in Action

![Multi-run comparison demo](media/hero.gif)
*View multiple training runs in seconds - no browser needed*

![Bread Wandb Viewer Screenshot](https://raw.githubusercontent.com/Bread-Technologies/bread_wandb_viewer_extension/main/screenshot.png)
*Compare W&B training metrics with interactive sidebar*

---

## Features

- 🔄 **Multi-Run Comparison** - Overlay multiple runs on the same charts with color coding and interactive toggles
- 🤖 **AI Context Export** - One-click markdown export for Claude Code, Cursor, and Codex with token counting
- 🎯 **Interactive Charts** - Zoom, pan, fullscreen, smoothing, plot reload, and chart copy
- 📂 **Automatic File Watching** - Extension detects new .wandb files and refreshes automatically
- 📊 **System Metrics** - GPU utilization, memory, CPU, disk I/O tracking
- 🔍 **Metadata Comparison** - Side-by-side config and hyperparameter diff highlighting
- 🎨 **Smart Grouping** - Metrics auto-organized by prefix (loss/, train/, val/, gpu.0/)
- 🔒 **Local Run Parsing** - Direct `.wandb` parsing with protobuf, without the W&B API or CLI
- ☁ **Optional Explicit Sync** - Upload selected local runs with an installed W&B CLI after confirmation
- 🎛️ **Advanced Controls** - Log scales, raw data overlay toggle, adjustable smoothing
- 📁 **Folder Scanning** - Automatically discover all runs in a directory

---

## Quick Start

### Installation

This fork is distributed through
[GitHub Releases](https://github.com/erikscheurer/Bread-WandB-Viewer/releases).
On Linux or macOS, install the latest release with:

```bash
curl -fL https://github.com/erikscheurer/Bread-WandB-Viewer/releases/latest/download/wandb-viewer.vsix -o /tmp/wandb-viewer.vsix && code --install-extension /tmp/wandb-viewer.vsix --force
```

On Windows PowerShell:

```powershell
$vsix = "$env:TEMP\wandb-viewer.vsix"; Invoke-WebRequest "https://github.com/erikscheurer/Bread-WandB-Viewer/releases/latest/download/wandb-viewer.vsix" -OutFile $vsix; code --install-extension $vsix --force
```

Alternatively, if you want to install this extension on a server, install the latest release with:

```bash
CODE_SERVER="$(find "$HOME/.vscode-server/" -path '*/code-server' -type f | head -n 1)" \
  && test -n "$CODE_SERVER" \
  && curl -fL https://github.com/erikscheurer/Bread-WandB-Viewer/releases/latest/download/wandb-viewer.vsix \
    -o /tmp/wandb-viewer-$USER.vsix \
  && "$CODE_SERVER" --install-extension /tmp/wandb-viewer-$USER.vsix --force
```

Then run `Developer: Reload Window` in VS Code. VS Code does not automatically
update extensions installed from a VSIX, so rerun the installation command to
upgrade to a newer release. Because the fork retains the upstream extension
identifier, installing this VSIX replaces an installed upstream copy.

<details>
<summary>Build and install from source</summary>

```bash
npm install
npm run compile
npm run package:vsix -- /tmp/wandb-viewer-local.vsix
code --install-extension /tmp/wandb-viewer-local.vsix --force
```

</details>

To install the original release instead, use the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=bread-tech.wandb-viewer)
or [upstream releases](https://github.com/Bread-Technologies/Bread-WandB-Viewer/releases).

**View a single run:**
1. Click any `.wandb` file in VS Code Explorer
2. Charts and metrics appear instantly

**Compare multiple runs:**
1. Right-click any folder with W&B runs
2. Select **Open in New Wandb Viewer**, or select **Add to Open Wandb Viewer**
   to merge the folder into an existing comparison tab
3. Check/uncheck runs in sidebar to compare

That's it! No configuration needed.

---

## Visual Demos

### AI Context Generation

![AI context generation demo](media/ai-content.gif)
*One-click AI context export for Claude Code, Cursor, and Codex*

---

## Features in Depth

### 🔄 Multi-Run Comparison

Compare training runs side-by-side to understand what hyperparameters and configurations work best - all without leaving VS Code.

- Overlay multiple runs on the same charts
- Color-coded run identification
- Interactive sidebar for toggling runs on/off
- Multiple independent comparison tabs titled `Wandb: <foldername>`
- Add multiple folders to one comparison tab
- Full run-name tooltips, creation times, empty-run highlighting, and sync badges
- A pulsing green dot for runs with recent file activity, indicating they are
  likely still running
- Click a run name to persistently emphasize it across overview and fullscreen
  charts without changing checkbox selection; click it again to clear the focus
- Create, edit, delete, and toggle named comparison groups from the bottom of the
  sidebar; a partially selected group displays an indeterminate checkbox
- Add a run to an existing or new comparison group from its right-click menu
- Right-click actions to copy the run ID, isolate a run, or sync it
- Resizable sidebar for better workspace management
- Resizable chart heights with draggable dividers
- Automatic folder scanning for all runs

Ideal for hyperparameter tuning, ablation studies, and experiment analysis. No need to switch to your browser to compare metrics.

Original W&B run names remain read-only because they are embedded in the `.wandb`
binary log. The run context menu can assign a custom display name instead. These
aliases are keyed by run ID in VS Code's extension-global storage, survive viewer
reloads, and never modify the run file. Submit an empty custom name to restore the
original name. The rename field starts with the run's current displayed name for
easy partial edits.

Comparison groups are saved as names and run IDs in
`.wandb-viewer-groups.json` in the first folder opened by the comparison panel.
This makes the selections shareable with collaborators without storing local paths
or run data. In a multi-folder panel, the group file still belongs to that first
folder, while a group may reference runs from any folder currently added to the
panel.

### ☁ Local Sync Status and Optional Upload

The sidebar mirrors the local status rules used by `wandb sync`: a green cloud is
synced, a crossed cloud is unsynced, and a neutral cloud means the status cannot be
determined from the folder layout. Successful offline syncs create a
`.wandb.synced` marker beside the run file; normal `run-*` directories are treated
as online/synced by the W&B CLI.

**Sync selected** and **Sync this run** invoke `wandb sync` from an installed local
W&B CLI. The extension always asks for confirmation first because this action
uploads run data to W&B. Viewing, parsing, comparison, and export do not invoke the
CLI or contact the W&B API. See the official
[W&B sync documentation](https://docs.wandb.ai/models/ref/cli/wandb-sync).

### 🤖 AI Context Export

Export your training runs as AI-optimized markdown for coding assistants like Claude Code, Cursor, and Codex.

Perfect for:
- Debugging training code with AI assistance
- Analyzing hyperparameter impact on model performance
- Generating experiment summaries and insights
- Understanding why certain runs performed better

Features:
- One-click copy to clipboard or save to file
- Token count estimation for context planning
- Formatted comparison tables
- CSV metric data for analysis
- Configuration diffs highlighted

### 🎯 Interactive Charts

Advanced chart controls for detailed metric analysis.

- **Smoothing:** Adjustable EMA smoothing with real-time preview
- **Zoom:** Drag horizontally to select X and fit Y to visible data, or drag a box to zoom both axes
- **Cursor Zoom:** Hold Ctrl and scroll to zoom both axes around the pointer
- **Pan:** Shift+drag in any direction to pan the X and Y axes
- **Fullscreen:** Click expand icon on any chart
- **Reload and copy:** Rebuild an overview or fullscreen plot with the reload button; copy a fullscreen chart directly to the clipboard
- **Log Scales:** Toggle X and Y axis logarithmic scales
- **Raw Data Overlay:** Show the raw trace behind its smoothed run in overview and fullscreen charts, with both values combined in one tooltip
- **Auto-decimation:** Large datasets (500+ points) automatically downsampled for performance

### 📂 Automatic File Watching

While the viewer is visible, the extension detects new or updated `.wandb` files
and refreshes changed run data at a throttled interval. Continually written runs
therefore keep updating without waiting for training to stop.

- Existing charts update in place, preserving zoom, log axes, smoothing, and
  fullscreen state
- Structural refreshes preserve the active metrics/configuration tab, metric and
  run filters, run ordering, sidebar tab and width, per-chart zoom, and hidden runs
- Live parsing and chart updates pause while the viewer is hidden to save CPU and
  resume with a catch-up scan when it becomes visible again
- A modification-time check catches file updates missed by the filesystem watcher
- Detects new runs added to folders
- Updates existing run views when files change

### 📊 Metadata & System Metrics

View comprehensive run information beyond just training metrics.

**Run Metadata:**
- Run creation time
- GPU type and count
- Python version
- CPU count and CUDA version
- Git remote and commit
- Runtime start timestamp

**System Metrics:**
- GPU utilization and memory
- CPU usage
- Disk I/O
- Memory consumption

### 🔒 Local & Private

Viewing and analysis keep your training data on your machine.

- Reads `.wandb` files directly using protobuf
- No W&B CLI or API is needed for viewing or analysis
- Does not collect or transmit analytics or telemetry
- Only an explicitly confirmed **Sync** action invokes the locally installed
  `wandb sync` command and uploads the chosen runs

Run parsing and analysis are local. The chart UI currently loads Chart.js and its
zoom plugin from jsDelivr when a webview opens, so displaying charts may require a
network connection if those assets are not cached.

---


### Requirements

- VS Code 1.74.0 or higher
- Training runs created with wandb SDK 0.15+
- Optional: the `wandb` CLI on `PATH` for the explicit Sync actions

---

## Commands & Usage

| Command | How to Access | Description |
|---------|---------------|-------------|
| **Open in New Wandb Viewer** | Right-click folder in Explorer | Opens a new comparison tab for all `.wandb` files in the folder |
| **Add to Open Wandb Viewer** | Right-click folder in Explorer | Adds a folder to an existing comparison tab; prompts when multiple tabs are open |
| **Open .wandb file** | Click any `.wandb` file | Opens single run view with charts and metadata |

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Zoom X range and fit Y | Drag horizontally across chart |
| Zoom X and Y range | Drag a box across chart |
| Zoom around cursor | Ctrl + scroll |
| Pan X and Y | Shift + drag |
| Reset zoom | Double-click chart |

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `wandbViewer.defaultRunSort` | `created-desc` | Initial multi-run ordering; supports creation time, name, and latest-update order |
| `wandbViewer.runColorPalette` | `tableau10` | Stable run colors from Tableau, Okabe–Ito, Observable, ColorBrewer, Paul Tol, Matplotlib, Plotly (24/26), or background-aware Glasbey (64) palettes; colors are not reused before the palette is exhausted |
| `wandbViewer.chartColumns` | `1` | Number of chart columns in the multi-run viewer; choose 1–4 to make the layout consistent across machines |

The additional categorical palettes follow the published
[D3/ColorBrewer schemes](https://d3js.org/d3-scale-chromatic/categorical) and
[Paul Tol qualitative line palettes](https://tol-colors.readthedocs.io/en/latest/colorsets.html).
The longer choices use
[Plotly qualitative sequences](https://plotly.com/python/discrete-color/) and
[Colorcet Glasbey palettes](https://colorcet.holoviz.org/user_guide/Categorical.html).

---

## Privacy

The extension does not collect or transmit usage analytics or error telemetry.
W&B run parsing, comparison, charting, and AI-context generation happen locally.
The sole run-data transmission path is the user-triggered Sync action: after a
modal confirmation, it passes the selected local file paths to the installed
`wandb sync` CLI, which uploads those runs according to the user's W&B CLI login
and configuration.

---

## Technical Details

For developers and power users interested in how this extension works.

### Architecture

- **Binary Parsing:** Direct protobuf parsing of `.wandb` files (LevelDB-style format)
- **No Viewing-Time W&B Cloud Dependencies:** No W&B CLI or API is required to parse runs
- **Optional Sync Integration:** Confirmed uploads spawn `wandb sync` without a shell; local status uses W&B's `.synced` marker convention
- **Performance:** LRU cache (20 runs), LTTB decimation for large datasets, lazy chart initialization
- **File Watching:** Throttled filesystem events backed by modification polling and periodic run discovery
- **Chart Library:** Chart.js 4.4.0 with zoom plugin for interactive visualizations

### Supported Record Types

- HistoryRecord (per-step training metrics)
- ConfigRecord (hyperparameters)
- SummaryRecord (final summary stats)
- StatsRecord (system statistics)
- EnvironmentRecord (Python, GPU, host metadata)
- RunRecord (project name, run ID, display name)
- And 15+ other internal record types

### Performance Optimizations

- **Quick Metadata:** Reads only first 16KB for fast folder scanning
- **Metric Decimation:** LTTB algorithm for datasets >500 points
- **Lazy Loading:** Charts initialized only when visible
- **LRU Cache:** Parsed run data cached (max 20 runs)
- **Coalesced Updates:** File changes are throttled and processed serially

---

## Issues & Support

Found a bug or have a feature request?

- **Report issues:** [GitHub Issues](https://github.com/erikscheurer/Bread-WandB-Viewer/issues)
- **Pull Requests:** Contributions welcome!
- **Fork source:** [erikscheurer/Bread-WandB-Viewer](https://github.com/erikscheurer/Bread-WandB-Viewer)
- **Original project:** [Bread-Technologies/Bread-WandB-Viewer](https://github.com/Bread-Technologies/Bread-WandB-Viewer)

---

## Why Bread Wandb Viewer?

**Problem:** Switching between VS Code and your browser to compare training runs breaks your flow and slows down iteration.

**Solution:** View and compare everything in VS Code. Multi-run comparison, AI context generation, and interactive charts - all without leaving your editor.

**Result:** Stay focused, iterate faster, and leverage AI coding assistants to analyze your experiments.

---

Originally created by [Bread Technologies](https://github.com/Bread-Technologies).
This fork contains additional community changes described above.
