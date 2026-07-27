# Bread Wandb Viewer

[![Version](https://img.shields.io/visual-studio-marketplace/v/bread-tech.wandb-viewer)](https://marketplace.visualstudio.com/items?itemName=bread-tech.wandb-viewer)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/bread-tech.wandb-viewer)](https://marketplace.visualstudio.com/items?itemName=bread-tech.wandb-viewer)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/bread-tech.wandb-viewer)](https://marketplace.visualstudio.com/items?itemName=bread-tech.wandb-viewer)
[![License](https://img.shields.io/github/license/Bread-Technologies/bread_wandb_viewer_extension)](LICENSE)

**Compare ML training runs side-by-side in VS Code - no browser switching, no waiting**

Stop switching to your browser to compare training runs. **Bread Wandb Viewer** brings Weights & Biases visualization directly into VS Code. Compare multiple runs side-by-side with interactive charts, export AI context for Claude Code/Cursor/Codex, and analyze experiments without leaving your editor.

Perfect for machine learning engineers, deep learning researchers, and data scientists who want to stay in their development environment.

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
- 🔒 **100% Offline** - Direct .wandb file parsing with protobuf, no API calls or internet needed
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

### 🔒 100% Offline & Private

Your training data never leaves your machine.

- Reads `.wandb` files directly using protobuf
- No wandb CLI or API needed
- No internet connection required
- Works completely offline
- Does not collect or transmit analytics or telemetry

---

## Installation

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=bread-tech.wandb-viewer), or download the `.vsix` from [releases](https://github.com/Bread-Technologies/bread_wandb_viewer_extension/releases):

```bash
code --install-extension wandb-viewer-0.2.2.vsix
```

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
- **No Dependencies:** No wandb CLI, API, or internet connection required
- **Performance:** LRU cache (20 runs), LTTB decimation for large datasets, lazy chart initialization
- **File Watching:** Automatic detection of file changes with 1-second debouncing
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
- **Debounced Updates:** File changes debounced to 1 second

---

## Actively Maintained

- ✅ Current version: 0.2.2
- ✅ Compatible with VS Code 1.74+
- ✅ Tested with wandb SDK 0.15+
- ✅ Open Source - contributions welcome

---

## Open Changes

### Run Refresh and Discovery

- [x] Add a reload button to the main viewer toolbar and single-metric fullscreen
  view that refreshes the data for all runs currently displayed while preserving
  the fullscreen metric and zoom.
- [x] Periodically rescan the selected folder for new runs.
- [x] Add a dedicated sidebar button to trigger run discovery immediately.

### Chart Interaction and State

- [x] Rework smoothing so the smoothed and raw series share the same visibility
  state. Hiding a run should hide every series associated with that run.
  Show the value of raw run in brackets next to the smoothed value when hovering over a smoothed series.
- [x] Preserve logarithmic-axis settings when runs, smoothing, visibility, or other
  viewer settings change.
- [x] Allow cursor-based range selection in overview charts, not only in fullscreen
  charts.
- [x] Make drag-to-zoom select the X-axis range by default and fit the Y-axis to
  data in the selected window. Shift-dragging should pan both axes.
  Dragging a box should zoom both axes, but dragging a horizontal line should only zoom the X-axis.
- [x] Double clicking one run's name in the chart legend should hide all other runs, and double clicking again should restore all runs to visible.
- [x] Allow users to resize the chart area in the multi-run viewer by dragging the divider between the chart area and the other charts below it.
- [ ] Global log-y and log-x toggles should carry over to the fullscreen chart view

### Performance

- [ ] Investigate lazy loading for runs. Start the multi-run viewer with runs
  deactivated and parse/load a run only when the user enables it, reducing initial
  startup time for folders containing many runs.

### Functionality

- [ ] Add a "Compare Configs" button to the multi-run viewer to show a side-by-side
  diff of the hyperparameter configurations for all runs currently displayed.
- [ ] Increase contrast for light mode. Maybe rework the color palette to be similar to vs code theme
- [ ] Colors for the multi-run viewer should be consistent upon reloading the viewer and across different sessions under changing number of runs.
- [ ] Add sorting and filtering options to the multi-run viewer sidebar (e.g., sort by run name, creation date, latest update)

---

## Issues & Support

Found a bug or have a feature request?

- **Report Issues:** [GitHub Issues](https://github.com/Bread-Technologies/bread_wandb_viewer_extension/issues)
- **Pull Requests:** Contributions welcome!
- **Documentation:** [Source Code](https://github.com/Bread-Technologies/bread_wandb_viewer_extension)

---

## Why Bread Wandb Viewer?

**Problem:** Switching between VS Code and your browser to compare training runs breaks your flow and slows down iteration.

**Solution:** View and compare everything in VS Code. Multi-run comparison, AI context generation, and interactive charts - all without leaving your editor.

**Result:** Stay focused, iterate faster, and leverage AI coding assistants to analyze your experiments.

---

Made with ❤️ by [Bread Technologies](https://github.com/Bread-Technologies)
