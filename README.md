# Bread Wandb Viewer — Community Fork

[![License](https://img.shields.io/github/license/erikscheurer/Bread-WandB-Viewer)](LICENSE)

> [!IMPORTANT]
> This repository is a community fork of
> [Bread Technologies' original Bread Wandb Viewer](https://github.com/Bread-Technologies/Bread-WandB-Viewer).
> It is not the source repository for the `bread-tech.wandb-viewer` extension on
> the VS Code Marketplace.

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
- **State-preserving chart updates** — refreshes retain zoom, smoothing, log axes,
  run visibility, and fullscreen state. Raw and smoothed traces behave as one run.
- **Improved chart interaction** — X-range and box zoom, two-axis panning,
  resizable chart rows, legend double-click isolation, linked run highlighting,
  and clearer cursor-sorted tooltips.
- **Better run comparison** — side-by-side configuration comparison with search,
  plus run filtering and sorting by name, creation time, or latest update.
- **Stable, theme-aware visuals** — deterministic `tab20` run colors, improved
  light-theme contrast, and unfilled run curves.

## Multi-Run Comparison in Action

![Multi-run comparison demo](media/hero.gif)
*View multiple training runs in seconds - no browser needed*

![Bread Wandb Viewer Screenshot](https://raw.githubusercontent.com/Bread-Technologies/bread_wandb_viewer_extension/main/screenshot.png)
*Compare W&B training metrics with interactive sidebar*

---

## Features

- 🔄 **Multi-Run Comparison** - Overlay multiple runs on the same charts with color coding and interactive toggles
- 🤖 **AI Context Export** - One-click markdown export for Claude Code, Cursor, and Codex with token counting
- 🎯 **Interactive Charts** - Zoom, pan, fullscreen, and smooth with EMA (exponential moving average)
- 📂 **Automatic File Watching** - Extension detects new .wandb files and refreshes automatically
- 📊 **System Metrics** - GPU utilization, memory, CPU, disk I/O tracking
- 🔍 **Metadata Comparison** - Side-by-side config and hyperparameter diff highlighting
- 🎨 **Smart Grouping** - Metrics auto-organized by prefix (loss/, train/, val/, gpu.0/)
- 🔒 **Local Run Parsing** - Direct `.wandb` parsing with protobuf, without the W&B API or CLI
- 🎛️ **Advanced Controls** - Log scales, raw data overlay toggle, adjustable smoothing
- 📁 **Folder Scanning** - Automatically discover all runs in a directory

---

## Quick Start

**View a single run:**
1. Click any `.wandb` file in VS Code Explorer
2. Charts and metrics appear instantly

**Compare multiple runs:**
1. Right-click any folder with W&B runs
2. Select "Bread Wandb Viewer"
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
- Resizable sidebar for better workspace management
- Resizable chart heights with draggable dividers
- Automatic folder scanning for all runs

Ideal for hyperparameter tuning, ablation studies, and experiment analysis. No need to switch to your browser to compare metrics.

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
- **Pan:** Shift+drag in any direction to pan the X and Y axes
- **Fullscreen:** Click expand icon on any chart
- **Log Scales:** Toggle X and Y axis logarithmic scales
- **Raw Data Overlay:** Show the raw trace behind its smoothed run in overview and fullscreen charts, with both values combined in one tooltip
- **Auto-decimation:** Large datasets (500+ points) automatically downsampled for performance

### 📂 Automatic File Watching

While the viewer is visible, the extension detects new or updated `.wandb` files
and refreshes changed run data at a throttled interval. Continually written runs
therefore keep updating without waiting for training to stop.

- Existing charts update in place, preserving zoom, log axes, smoothing, and
  fullscreen state
- Live parsing and chart updates pause while the viewer is hidden to save CPU and
  resume with a catch-up scan when it becomes visible again
- A modification-time check catches file updates missed by the filesystem watcher
- Detects new runs added to folders
- Updates existing run views when files change

### 📊 Metadata & System Metrics

View comprehensive run information beyond just training metrics.

**Run Metadata:**
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

Your training data never leaves your machine.

- Reads `.wandb` files directly using protobuf
- No wandb CLI or API needed
- Does not collect or transmit analytics or telemetry

Run parsing and analysis are local. The chart UI currently loads Chart.js and its
zoom plugin from jsDelivr when a webview opens, so displaying charts may require a
network connection if those assets are not cached.

---

## Installation

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

### Requirements

- VS Code 1.74.0 or higher
- Training runs created with wandb SDK 0.15+

---

## Commands & Usage

| Command | How to Access | Description |
|---------|---------------|-------------|
| **Bread Wandb Viewer** | Right-click folder in Explorer | Opens multi-run comparison view for all `.wandb` files in folder |
| **Open .wandb file** | Click any `.wandb` file | Opens single run view with charts and metadata |

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Zoom X range and fit Y | Drag horizontally across chart |
| Zoom X and Y range | Drag a box across chart |
| Pan X and Y | Shift + drag |
| Reset zoom | Double-click chart |

---

## Privacy

The extension does not collect or transmit usage analytics, error telemetry, run
metadata, metric values, file paths, code, hyperparameters, or configuration data.
W&B run parsing and analysis happen locally.

---

## Technical Details

For developers and power users interested in how this extension works.

### Architecture

- **Binary Parsing:** Direct protobuf parsing of `.wandb` files (LevelDB-style format)
- **No W&B Cloud Dependencies:** No W&B CLI or API is required to parse runs
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
