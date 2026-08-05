import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { MultiRunManager, MergedMetric } from './MultiRunManager';
import { scanFolderForRuns, watchFolder, FileChangeEvent, RunScanResult } from './MultiRunScanner';
import { getChartStyles, getChartScript, getModalHtml, getControlsBarHtml } from './chartTemplate';
import { generateAIContext, calculateTokenEstimate } from './aiContext/ContextGenerator';
import { compareConfigs } from './aiContext/ConfigDiffer';
import {
    DEFAULT_RUN_COLOR_PALETTE,
    isRunColorPaletteName,
    RunColorPaletteName
} from './runColors';
import {
    getCustomRunNames,
    setCustomRunName,
    validateCustomRunName
} from './customRunNames';
import {
    loadRunComparisonGroups,
    RunComparisonGroup,
    RUN_COMPARISON_GROUPS_FILE,
    saveRunComparisonGroups,
    validateRunComparisonGroupName
} from './runComparisonGroups';

const RUN_SORT_MODES = [
    'created-desc',
    'created-asc',
    'name-asc',
    'name-desc',
    'updated-desc',
    'updated-asc'
] as const;

type RunSortMode = typeof RUN_SORT_MODES[number];

const DEFAULT_RUN_SORT: RunSortMode = 'created-desc';
const RUN_ACTIVITY_WINDOW_MS = 2 * 60 * 1000;

function isRunSortMode(value: unknown): value is RunSortMode {
    return typeof value === 'string' &&
        (RUN_SORT_MODES as readonly string[]).includes(value);
}

export class MultiRunViewerPanel {
    private static readonly panels = new Set<MultiRunViewerPanel>();
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _manager: MultiRunManager;
    private _folderWatchers = new Map<string, vscode.Disposable>();
    private _folderPath: string;
    private _folderPaths = new Set<string>();
    private _pendingFileChanges = new Map<string, FileChangeEvent>();
    private _processingFileChanges = false;
    private _needsVisibleCatchUp = false;
    private _disposed = false;
    private _initialUpdateTimer: NodeJS.Timeout | null = null;
    private _defaultRunSort: RunSortMode;
    private _colorPalette: RunColorPaletteName;
    private readonly _nameStorage: vscode.Memento;
    private _customRunNames: Record<string, string>;
    private _isFullscreenOpen = false;
    private _selectionRefreshTimer: NodeJS.Timeout | null = null;
    private _selectionRefreshInProgress = false;
    private _selectionRefreshPending = false;
    private _comparisonGroups: RunComparisonGroup[] = [];
    private _comparisonGroupsLoadErrorShown = false;

    public static createOrShow(
        extensionUri: vscode.Uri,
        folderPath: string,
        nameStorage: vscode.Memento
    ): MultiRunViewerPanel {
        const panel = vscode.window.createWebviewPanel(
            'wandbMultiRunViewer',
            MultiRunViewerPanel.getPanelTitle([folderPath]),
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );
        panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.png');

        const viewer = new MultiRunViewerPanel(
            panel,
            extensionUri,
            folderPath,
            nameStorage
        );
        MultiRunViewerPanel.panels.add(viewer);
        return viewer;
    }

    public static async addFolderToExisting(
        extensionUri: vscode.Uri,
        folderPath: string,
        nameStorage: vscode.Memento
    ): Promise<MultiRunViewerPanel> {
        const openPanels = Array.from(MultiRunViewerPanel.panels)
            .filter(panel => !panel._disposed);
        if (openPanels.length === 0) {
            return MultiRunViewerPanel.createOrShow(
                extensionUri,
                folderPath,
                nameStorage
            );
        }

        let targetPanel = openPanels[0];
        if (openPanels.length > 1) {
            const selection = await vscode.window.showQuickPick(
                openPanels.map(panel => ({
                    label: panel._panel.title,
                    description: Array.from(panel._folderPaths).join(' • '),
                    panel
                })),
                { placeHolder: 'Choose the Wandb Viewer to add runs to' }
            );
            if (!selection) {
                return targetPanel;
            }
            targetPanel = selection.panel;
        }

        await targetPanel.addFolder(folderPath);
        targetPanel._panel.reveal(vscode.ViewColumn.One);
        return targetPanel;
    }

    private static getPanelTitle(folderPaths: Iterable<string>): string {
        const folderNames = Array.from(folderPaths, folderPath =>
            path.basename(path.resolve(folderPath)) || folderPath
        );
        if (folderNames.length <= 1) {
            return `Wandb: ${folderNames[0] || 'Runs'}`;
        }
        return `Wandb: ${folderNames[0]} +${folderNames.length - 1}`;
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        folderPath: string,
        nameStorage: vscode.Memento
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._folderPath = path.resolve(folderPath);
        this._folderPaths.add(this._folderPath);
        this._nameStorage = nameStorage;
        this._customRunNames = getCustomRunNames(nameStorage);
        const configuration = vscode.workspace.getConfiguration('wandbViewer');
        const configuredRunSort = configuration.get<string>('defaultRunSort');
        const configuredColorPalette = configuration.get<string>('runColorPalette');
        this._defaultRunSort = isRunSortMode(configuredRunSort)
            ? configuredRunSort
            : DEFAULT_RUN_SORT;
        this._colorPalette = isRunColorPaletteName(configuredColorPalette)
            ? configuredColorPalette
            : DEFAULT_RUN_COLOR_PALETTE;
        this._manager = new MultiRunManager(folderPath, this._colorPalette);

        // Show loading screen immediately
        this._panel.webview.html = this._getLoadingHtml();
        
        // Defer the actual work so loading spinner can render
        this._initialUpdateTimer = setTimeout(() => {
            this._initialUpdateTimer = null;
            if (!this._disposed) {
                void this._update();
            }
        }, 50); // 50ms delay allows the loading screen to paint
        
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('wandbViewer.defaultRunSort')) {
                const value = vscode.workspace
                    .getConfiguration('wandbViewer')
                    .get<string>('defaultRunSort');
                this._defaultRunSort = isRunSortMode(value)
                    ? value
                    : DEFAULT_RUN_SORT;
            }

            if (event.affectsConfiguration('wandbViewer.runColorPalette')) {
                const value = vscode.workspace
                    .getConfiguration('wandbViewer')
                    .get<string>('runColorPalette');
                const nextPalette = isRunColorPaletteName(value)
                    ? value
                    : DEFAULT_RUN_COLOR_PALETTE;
                if (nextPalette !== this._colorPalette) {
                    this._colorPalette = nextPalette;
                    this._manager.setColorPalette(nextPalette);
                    void this._updateRunColorsInWebview();
                }
            }
        }, null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'toggleRun':
                        if (
                            typeof message.runId === 'string' &&
                            typeof message.selected === 'boolean'
                        ) {
                            if (typeof message.fullscreenOpen === 'boolean') {
                                this._isFullscreenOpen = message.fullscreenOpen;
                            }
                            const accepted = this._manager.setRunSelected(
                                message.runId,
                                message.selected
                            );
                            await this._panel.webview.postMessage({
                                command: 'runSelectionAcknowledged',
                                runId: message.runId,
                                selected: this._manager.isRunSelected(message.runId),
                                accepted
                            });
                            if (accepted) {
                                this._scheduleSelectionRefresh();
                            }
                        }
                        break;
                    case 'copyRunId':
                        if (
                            typeof message.runId === 'string' &&
                            this._manager.getState().runs.has(message.runId)
                        ) {
                            await vscode.env.clipboard.writeText(message.runId);
                            vscode.window.showInformationMessage('Run ID copied.');
                        }
                        break;
                    case 'toggleComparisonGroup':
                        if (
                            typeof message.groupId === 'string' &&
                            typeof message.selected === 'boolean'
                        ) {
                            if (typeof message.fullscreenOpen === 'boolean') {
                                this._isFullscreenOpen = message.fullscreenOpen;
                            }
                            await this._setComparisonGroupSelected(
                                message.groupId,
                                message.selected
                            );
                        }
                        break;
                    case 'createComparisonGroup':
                        await this._editComparisonGroup();
                        break;
                    case 'editComparisonGroup':
                        if (typeof message.groupId === 'string') {
                            await this._editComparisonGroup(message.groupId);
                        }
                        break;
                    case 'deleteComparisonGroup':
                        if (typeof message.groupId === 'string') {
                            await this._deleteComparisonGroup(message.groupId);
                        }
                        break;
                    case 'addRunToComparisonGroup':
                        if (typeof message.runId === 'string') {
                            await this._addRunToComparisonGroup(message.runId);
                        }
                        break;
                    case 'showOnlyRun':
                        if (
                            typeof message.runId === 'string' &&
                            this._manager.selectOnly(message.runId)
                        ) {
                            if (typeof message.fullscreenOpen === 'boolean') {
                                this._isFullscreenOpen = message.fullscreenOpen;
                            }
                            await this._panel.webview.postMessage({
                                command: 'bulkRunSelectionAcknowledged',
                                selectedRunIds: this._manager.getSelectedRunIds()
                            });
                            this._scheduleSelectionRefresh();
                        }
                        break;
                    case 'renameRun':
                        if (typeof message.runId === 'string') {
                            await this._renameRun(message.runId);
                        }
                        break;
                    case 'fullscreenStateChanged':
                        this._isFullscreenOpen = message.open === true;
                        break;
                    case 'syncRuns':
                        try {
                            const runIds = Array.isArray(message.runIds)
                                ? message.runIds.filter((runId: unknown): runId is string =>
                                    typeof runId === 'string'
                                )
                                : this._manager.getSelectedRunIds();
                            await this._handleSyncRuns(runIds);
                        } finally {
                            await this._panel.webview.postMessage({
                                command: 'syncRunsComplete',
                                canSync: this._manager.getSelectedCount() > 0
                            });
                        }
                        break;
                    case 'selectAll':
                        if (typeof message.fullscreenOpen === 'boolean') {
                            this._isFullscreenOpen = message.fullscreenOpen;
                        }
                        this._manager.selectAll();
                        await this._panel.webview.postMessage({
                            command: 'bulkRunSelectionAcknowledged',
                            selectedRunIds: this._manager.getSelectedRunIds()
                        });
                        this._scheduleSelectionRefresh();
                        break;
                    case 'deselectAll':
                        if (typeof message.fullscreenOpen === 'boolean') {
                            this._isFullscreenOpen = message.fullscreenOpen;
                        }
                        this._manager.deselectAll();
                        await this._panel.webview.postMessage({
                            command: 'bulkRunSelectionAcknowledged',
                            selectedRunIds: []
                        });
                        this._scheduleSelectionRefresh();
                        break;
                    case 'reloadSelectedRuns':
                        try {
                            await this._reloadSelectedRuns();
                        } catch {
                            vscode.window.showErrorMessage('Failed to reload the selected runs.');
                        } finally {
                            await this._panel.webview.postMessage({
                                command: 'reloadSelectedRunsComplete',
                                canReload: this._manager.getSelectedCount() > 0
                            });
                        }
                        break;
                    case 'rediscoverRuns':
                        try {
                            const discoveredCount = await this._rediscoverRuns();
                            const message = discoveredCount === 0
                                ? 'No new runs found.'
                                : discoveredCount === 1
                                    ? 'Discovered 1 new run.'
                                    : `Discovered ${discoveredCount} new runs.`;
                            vscode.window.showInformationMessage(message);
                        } catch {
                            vscode.window.showErrorMessage('Failed to rediscover runs.');
                        } finally {
                            await this._panel.webview.postMessage({
                                command: 'rediscoverRunsComplete'
                            });
                        }
                        break;
                    case 'generateAIContext':
                        await this._handleGenerateAIContext(message.action);
                        break;
                    case 'saveChartImage':
                        await this._handleSaveChartImage(message.imageBase64, message.chartCount);
                        break;
                    case 'copyChartImageFallback':
                        await this._handleCopyChartImageFallback(message.imageBase64);
                        break;
                    case 'showWarning':
                        vscode.window.showWarningMessage(message.message);
                        break;
                }
            },
            null,
            this._disposables
        );

        this._panel.onDidChangeViewState(event => {
            if (!event.webviewPanel.visible) {
                this._needsVisibleCatchUp = true;
                return;
            }

            if (this._needsVisibleCatchUp) {
                this._needsVisibleCatchUp = false;
                void this._queueVisibleCatchUp();
            } else {
                void this._processPendingFileChanges();
            }
        }, null, this._disposables);

        // Watch for file changes only while the panel is visible. When it becomes
        // visible again, a metadata scan catches up on changes made while hidden.
        this._watchFolder(this._folderPath);
    }

    private async addFolder(folderPath: string): Promise<void> {
        const resolvedFolderPath = path.resolve(folderPath);
        if (this._folderPaths.has(resolvedFolderPath)) {
            vscode.window.showInformationMessage('That folder is already open in this Wandb Viewer.');
            return;
        }

        this._folderPaths.add(resolvedFolderPath);
        this._watchFolder(resolvedFolderPath);
        this._panel.title = MultiRunViewerPanel.getPanelTitle(this._folderPaths);
        await this._update(true);
    }

    private _scheduleSelectionRefresh(): void {
        this._selectionRefreshPending = true;
        if (this._selectionRefreshTimer) {
            clearTimeout(this._selectionRefreshTimer);
            this._selectionRefreshTimer = null;
        }
        if (this._selectionRefreshInProgress || this._disposed) {
            return;
        }

        this._selectionRefreshTimer = setTimeout(() => {
            this._selectionRefreshTimer = null;
            void this._flushSelectionRefresh();
        }, 250);
    }

    private async _flushSelectionRefresh(): Promise<void> {
        if (
            this._selectionRefreshInProgress ||
            !this._selectionRefreshPending ||
            this._disposed
        ) {
            return;
        }

        this._selectionRefreshInProgress = true;
        this._selectionRefreshPending = false;
        try {
            await this._update(false);
        } catch (error) {
            console.error('Failed to refresh selected runs:', error);
            vscode.window.showErrorMessage('Failed to refresh the selected runs.');
        } finally {
            this._selectionRefreshInProgress = false;
            if (!this._disposed) {
                await this._panel.webview.postMessage({
                    command: 'runSelectionRefreshComplete'
                });
            }
            if (this._selectionRefreshPending) {
                this._scheduleSelectionRefresh();
            }
        }
    }

    private _watchFolder(folderPath: string): void {
        if (this._folderWatchers.has(folderPath)) {
            return;
        }

        const watcher = watchFolder(
            folderPath,
            event => this._queueFileChange(event),
            () => this._panel.visible && !this._disposed
        );
        this._folderWatchers.set(folderPath, watcher);
    }

    private async _scanFolders(): Promise<RunScanResult[]> {
        const scans = await Promise.all(
            Array.from(this._folderPaths, folderPath => scanFolderForRuns(folderPath))
        );
        const runsByFilePath = new Map<string, RunScanResult>();
        for (const runs of scans) {
            for (const run of runs) {
                runsByFilePath.set(path.resolve(run.filePath), run);
            }
        }
        return Array.from(runsByFilePath.values());
    }

    private async _reloadSelectedRuns(): Promise<void> {
        if (this._manager.getSelectedCount() === 0) {
            vscode.window.showInformationMessage('Select at least one run to reload.');
            return;
        }

        this._manager.invalidateSelectedRuns();
        await this._refreshRunDataInWebview();
    }

    private _queueFileChange(event: FileChangeEvent): void {
        this._pendingFileChanges.set(event.filePath, event);
        void this._processPendingFileChanges();
    }

    private async _queueVisibleCatchUp(): Promise<void> {
        try {
            const discoveredRuns = await this._scanFolders();
            const existingRuns = new Map(
                this._manager.getRuns().map(run => [run.runId, run])
            );
            const discoveredRunIds = new Set(discoveredRuns.map(run => run.runId));

            for (const run of discoveredRuns) {
                const existingRun = existingRuns.get(run.runId);
                if (!existingRun) {
                    this._pendingFileChanges.set(run.filePath, {
                        type: 'added',
                        filePath: run.filePath,
                        metadata: run
                    });
                } else if (
                    existingRun.lastModified !== run.lastModified ||
                    existingRun.fileSize !== run.fileSize
                ) {
                    this._pendingFileChanges.set(run.filePath, {
                        type: 'modified',
                        filePath: run.filePath,
                        metadata: run
                    });
                }
            }

            for (const existingRun of existingRuns.values()) {
                if (!discoveredRunIds.has(existingRun.runId)) {
                    this._pendingFileChanges.set(existingRun.filePath, {
                        type: 'deleted',
                        filePath: existingRun.filePath
                    });
                }
            }

            await this._processPendingFileChanges();
        } catch (error) {
            console.error('Failed to catch up on run changes:', error);
        }
    }

    private async _processPendingFileChanges(): Promise<void> {
        if (
            this._processingFileChanges ||
            this._disposed ||
            !this._panel.visible
        ) {
            return;
        }

        this._processingFileChanges = true;

        try {
            while (this._pendingFileChanges.size > 0 && this._panel.visible) {
                const changes = Array.from(this._pendingFileChanges.values());
                this._pendingFileChanges.clear();

                if (changes.some(change => change.type !== 'modified')) {
                    await this._update(true);
                    continue;
                }

                const selectedRunIds = new Set(this._manager.getSelectedRunIds());
                let selectedRunChanged = false;

                for (const change of changes) {
                    if (!change.metadata) {
                        continue;
                    }

                    this._manager.updateRun(change.metadata);
                    if (selectedRunIds.has(change.metadata.runId)) {
                        selectedRunChanged = true;
                    }
                }

                if (selectedRunChanged) {
                    await this._refreshRunDataInWebview();
                } else {
                    await this._updateRunActivityInWebview();
                }
            }
        } catch (error) {
            console.error('Failed to process live run updates:', error);
        } finally {
            this._processingFileChanges = false;
        }
    }

    private async _refreshRunDataInWebview(): Promise<void> {
        await this._manager.parseSelectedRuns();
        await this._panel.webview.postMessage({
            command: 'runDataUpdated',
            mergedMetrics: this._getMergedMetrics(),
            runContentStatuses: this._getRunContentStatuses(),
            runLastModified: this._getRunLastModified()
        });
    }

    private async _updateRunActivityInWebview(): Promise<void> {
        await this._panel.webview.postMessage({
            command: 'runActivityUpdated',
            runLastModified: this._getRunLastModified()
        });
    }

    private _getRunLastModified(): Record<string, number> {
        return Object.fromEntries(
            this._manager.getRuns().map(run => [run.runId, run.lastModified])
        );
    }

    private _getRunContentStatuses(): Record<string, string> {
        return Object.fromEntries(
            this._manager.getRuns().map(run => [
                run.runId,
                this._manager.getRunContentStatus(run.runId)
            ])
        );
    }

    private _getDisplayRunName(run: RunScanResult): string {
        return this._customRunNames[run.runId] || run.runName;
    }

    private _withDisplayRunName(run: RunScanResult): RunScanResult {
        return {
            ...run,
            runName: this._getDisplayRunName(run)
        };
    }

    private _getMergedMetrics(): { training: MergedMetric[], system: MergedMetric[] } {
        const mergedMetrics = this._manager.mergeMetrics();
        for (const metric of [...mergedMetrics.training, ...mergedMetrics.system]) {
            for (const dataset of metric.datasets) {
                dataset.runName = this._customRunNames[dataset.runId] || dataset.runName;
            }
        }
        return mergedMetrics;
    }

    private async _renameRun(runId: string): Promise<void> {
        const run = this._manager.getState().runs.get(runId);
        if (!run) {
            return;
        }

        const customName = await vscode.window.showInputBox({
            title: 'Set Custom Run Name',
            prompt: 'Stored by this VS Code extension. Leave empty to restore the original W&B name.',
            value: this._customRunNames[runId] || run.runName,
            placeHolder: run.runName,
            validateInput: validateCustomRunName
        });
        if (customName === undefined) {
            return;
        }

        const updatedNames = await setCustomRunName(
            this._nameStorage,
            runId,
            customName
        );
        const refreshes: Promise<void>[] = [];
        for (const panel of MultiRunViewerPanel.panels) {
            if (panel._disposed) {
                continue;
            }
            panel._customRunNames = updatedNames;
            refreshes.push(panel._update(false));
        }
        await Promise.all(refreshes);
    }

    private async _loadComparisonGroups(): Promise<void> {
        try {
            this._comparisonGroups = await loadRunComparisonGroups(this._folderPath);
            this._comparisonGroupsLoadErrorShown = false;
        } catch {
            if (!this._comparisonGroupsLoadErrorShown) {
                this._comparisonGroupsLoadErrorShown = true;
                vscode.window.showWarningMessage(
                    `Could not read ${RUN_COMPARISON_GROUPS_FILE}; existing comparison groups were left unchanged.`
                );
            }
        }
    }

    private async _saveComparisonGroups(): Promise<boolean> {
        try {
            await saveRunComparisonGroups(this._folderPath, this._comparisonGroups);
            return true;
        } catch {
            vscode.window.showErrorMessage('Could not save comparison groups.');
            return false;
        }
    }

    private _getComparisonGroup(groupId: string): RunComparisonGroup | undefined {
        return this._comparisonGroups.find(group => group.id === groupId);
    }

    private _createComparisonGroupId(): string {
        const baseId = `group-${Date.now().toString(36)}`;
        let groupId = baseId;
        let suffix = 2;
        while (this._getComparisonGroup(groupId)) {
            groupId = `${baseId}-${suffix}`;
            suffix += 1;
        }
        return groupId;
    }

    private async _editComparisonGroup(
        groupId?: string,
        requiredRunId?: string
    ): Promise<void> {
        const existingGroup = groupId ? this._getComparisonGroup(groupId) : undefined;
        if (groupId && !existingGroup) {
            return;
        }
        if (requiredRunId && !this._manager.getState().runs.has(requiredRunId)) {
            return;
        }

        const name = await vscode.window.showInputBox({
            title: existingGroup ? 'Edit Comparison Group' : 'Create Comparison Group',
            prompt: 'Name this reusable run selection',
            value: existingGroup?.name || '',
            ignoreFocusOut: true,
            validateInput: value => {
                const validationError = validateRunComparisonGroupName(value);
                if (validationError) {
                    return validationError;
                }
                const normalizedName = value.trim().toLocaleLowerCase();
                const duplicate = this._comparisonGroups.some(group =>
                    group.id !== existingGroup?.id &&
                    group.name.toLocaleLowerCase() === normalizedName
                );
                return duplicate
                    ? 'A comparison group with this name already exists.'
                    : undefined;
            }
        });
        if (name === undefined) {
            return;
        }

        const currentRunIds = new Set(existingGroup?.runIds || []);
        if (requiredRunId) {
            currentRunIds.add(requiredRunId);
        }
        const knownRuns = this._manager.getRuns();
        const knownRunIds = new Set(knownRuns.map(run => run.runId));
        const runItems: Array<vscode.QuickPickItem & { runId: string }> =
            knownRuns.map(run => ({
                label: this._getDisplayRunName(run),
                description: run.runId,
                runId: run.runId,
                picked: currentRunIds.has(run.runId)
            }));
        for (const unknownRunId of currentRunIds) {
            if (!knownRunIds.has(unknownRunId)) {
                runItems.push({
                    label: unknownRunId,
                    description: 'Run is not currently open',
                    runId: unknownRunId,
                    picked: true
                });
            }
        }

        const selectedRuns = await vscode.window.showQuickPick(runItems, {
            title: 'Choose Runs for Comparison Group',
            placeHolder: 'Select one or more runs',
            canPickMany: true,
            ignoreFocusOut: true
        });
        if (!selectedRuns) {
            return;
        }
        if (selectedRuns.length === 0) {
            vscode.window.showWarningMessage(
                'A comparison group must contain at least one run.'
            );
            return;
        }

        const nextGroup: RunComparisonGroup = {
            id: existingGroup?.id || this._createComparisonGroupId(),
            name: name.trim(),
            runIds: selectedRuns.map(item => item.runId)
        };
        const previousGroups = this._comparisonGroups;
        this._comparisonGroups = existingGroup
            ? previousGroups.map(group =>
                group.id === existingGroup.id ? nextGroup : group
            )
            : [...previousGroups, nextGroup];
        if (!await this._saveComparisonGroups()) {
            this._comparisonGroups = previousGroups;
            return;
        }
        await this._update(false);
    }

    private async _addRunToComparisonGroup(runId: string): Promise<void> {
        if (!this._manager.getState().runs.has(runId)) {
            return;
        }

        const choices: Array<vscode.QuickPickItem & { groupId?: string }> = [
            { label: '$(add) Create a new comparison group…' },
            ...this._comparisonGroups.map(group => ({
                label: group.name,
                description: `${group.runIds.length} run${group.runIds.length === 1 ? '' : 's'}`,
                groupId: group.id
            }))
        ];
        const selected = await vscode.window.showQuickPick(choices, {
            title: 'Add Run to Comparison Group',
            placeHolder: 'Choose a group',
            ignoreFocusOut: true
        });
        if (!selected) {
            return;
        }
        if (!selected.groupId) {
            await this._editComparisonGroup(undefined, runId);
            return;
        }

        const group = this._getComparisonGroup(selected.groupId);
        if (!group || group.runIds.includes(runId)) {
            if (group) {
                vscode.window.showInformationMessage(
                    `This run is already in “${group.name}”.`
                );
            }
            return;
        }

        const previousGroups = this._comparisonGroups;
        this._comparisonGroups = previousGroups.map(candidate =>
            candidate.id === group.id
                ? { ...candidate, runIds: [...candidate.runIds, runId] }
                : candidate
        );
        if (!await this._saveComparisonGroups()) {
            this._comparisonGroups = previousGroups;
            return;
        }
        await this._update(false);
    }

    private async _deleteComparisonGroup(groupId: string): Promise<void> {
        const group = this._getComparisonGroup(groupId);
        if (!group) {
            return;
        }
        const confirmation = await vscode.window.showWarningMessage(
            `Delete the comparison group “${group.name}”?`,
            { modal: true },
            'Delete'
        );
        if (confirmation !== 'Delete') {
            return;
        }

        const previousGroups = this._comparisonGroups;
        this._comparisonGroups = previousGroups.filter(
            candidate => candidate.id !== groupId
        );
        if (!await this._saveComparisonGroups()) {
            this._comparisonGroups = previousGroups;
            return;
        }
        await this._update(false);
    }

    private async _setComparisonGroupSelected(
        groupId: string,
        selected: boolean
    ): Promise<void> {
        const group = this._getComparisonGroup(groupId);
        if (!group) {
            return;
        }
        for (const runId of group.runIds) {
            this._manager.setRunSelected(runId, selected);
        }
        await this._panel.webview.postMessage({
            command: 'bulkRunSelectionAcknowledged',
            selectedRunIds: this._manager.getSelectedRunIds()
        });
        this._scheduleSelectionRefresh();
    }

    private async _handleSyncRuns(runIds: string[]): Promise<void> {
        const uniqueRunIds = Array.from(new Set(runIds));
        const runs = uniqueRunIds
            .map(runId => this._manager.getState().runs.get(runId))
            .filter((run): run is RunScanResult => Boolean(run));
        if (runs.length === 0) {
            vscode.window.showInformationMessage('Select at least one run to sync.');
            return;
        }

        const confirmation = await vscode.window.showWarningMessage(
            `Sync ${runs.length} run${runs.length === 1 ? '' : 's'} to the W&B cloud using the local wandb CLI? This uploads run data.`,
            { modal: true },
            'Sync'
        );
        if (confirmation !== 'Sync') {
            return;
        }

        let syncedCount = 0;
        let failedCount = 0;
        let cliUnavailable = false;
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Syncing W&B runs...',
                cancellable: true
            },
            async (progress, cancellationToken) => {
                for (let index = 0; index < runs.length; index++) {
                    if (cancellationToken.isCancellationRequested) {
                        break;
                    }
                    progress.report({
                        message: `${index + 1}/${runs.length}`,
                        increment: 100 / runs.length
                    });
                    try {
                        await this._runWandbSync(runs[index].filePath, cancellationToken);
                        syncedCount++;
                    } catch (error) {
                        failedCount++;
                        if (
                            error instanceof Error &&
                            error.message === 'wandb-cli-unavailable'
                        ) {
                            cliUnavailable = true;
                            break;
                        }
                    }
                }
            }
        );

        await this._update(true);
        if (cliUnavailable) {
            vscode.window.showErrorMessage(
                'The wandb CLI is not installed or is not available on PATH.'
            );
        } else if (failedCount > 0) {
            vscode.window.showWarningMessage(
                `${syncedCount} run${syncedCount === 1 ? '' : 's'} synced; ${failedCount} failed. Check your W&B login and network connection.`
            );
        } else if (syncedCount > 0) {
            vscode.window.showInformationMessage(
                `${syncedCount} run${syncedCount === 1 ? '' : 's'} synced to W&B.`
            );
        }
    }

    private _runWandbSync(
        filePath: string,
        cancellationToken: vscode.CancellationToken
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const childProcess = spawn('wandb', ['sync', filePath], {
                cwd: path.dirname(filePath),
                shell: false,
                stdio: 'ignore',
                windowsHide: true
            });
            let settled = false;
            const cancellation = cancellationToken.onCancellationRequested(() => {
                childProcess.kill();
            });
            const finish = (error?: Error): void => {
                if (settled) {
                    return;
                }
                settled = true;
                cancellation.dispose();
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            };

            childProcess.on('error', error => {
                finish(new Error((error as NodeJS.ErrnoException).code === 'ENOENT'
                    ? 'wandb-cli-unavailable'
                    : 'wandb-sync-failed'));
            });
            childProcess.on('close', code => {
                finish(code === 0 ? undefined : new Error('wandb-sync-failed'));
            });
        });
    }

    private async _updateRunColorsInWebview(): Promise<void> {
        const runColors = Object.fromEntries(
            this._manager.getRuns().map(run => [
                run.runId,
                this._manager.getRunColor(run.runId)
            ])
        );
        await this._panel.webview.postMessage({
            command: 'runColorsUpdated',
            runColors,
            mergedMetrics: this._getMergedMetrics()
        });
    }

    private async _rediscoverRuns(): Promise<number> {
        const knownRunIds = new Set(this._manager.getRuns().map(run => run.runId));
        await this._update(true);

        return this._manager.getRuns()
            .filter(run => !knownRunIds.has(run.runId))
            .length;
    }

    private async _update(scanForRuns: boolean = true): Promise<void> {
        const overallStart = Date.now();
        console.log('=== Multi-Run View Update Started ===');

        if (scanForRuns) {
            await this._loadComparisonGroups();
            const t1 = Date.now();
            const discoveredRuns = await this._scanFolders();
            const scanTime = Date.now() - t1;
            console.log(`[1] Folder scan: ${scanTime}ms (found ${discoveredRuns.length} runs)`);

            // Update manager with discovered runs
            const t2 = Date.now();
            const currentRuns = new Set(this._manager.getRuns().map(run => run.runId));
            const discoveredRunIds = new Set(discoveredRuns.map(run => run.runId));

            const orderedDiscoveredRuns = [...discoveredRuns]
                .sort((left, right) => left.runId.localeCompare(right.runId));

            for (const run of orderedDiscoveredRuns) {
                if (currentRuns.has(run.runId)) {
                    this._manager.updateRun(run);
                } else {
                    this._manager.addRun(run);
                }
            }

            for (const existingRun of this._manager.getRuns()) {
                if (!discoveredRunIds.has(existingRun.runId)) {
                    this._manager.removeRun(existingRun.runId);
                }
            }
            console.log(`[2] Run management: ${Date.now() - t2}ms`);
        } else {
            console.log('[1-2] Folder scan skipped');
        }

        const runs = this._manager.getRuns();

        // Parse selected runs and merge metrics
        const t3 = Date.now();
        await this._manager.parseSelectedRuns();
        console.log(`[3] Parsing runs: ${Date.now() - t3}ms (${this._manager.getSelectedRunIds().length} selected)`);

        const t4 = Date.now();
        const selectedRunIds = this._manager.getSelectedRunIds();
        const mergedMetrics = this._getMergedMetrics();
        console.log(`[4] Merge metrics: ${Date.now() - t4}ms (${mergedMetrics.training.length} training, ${mergedMetrics.system.length} system)`);

        const t6 = Date.now();
        const displayRuns = runs.map(run => this._withDisplayRunName(run));
        const htmlContent = this._getHtmlContent(
            displayRuns,
            selectedRunIds,
            mergedMetrics
        );
        console.log(`[6] Generate HTML: ${Date.now() - t6}ms (${Math.round(htmlContent.length / 1024)}KB)`);

        const t7 = Date.now();
        this._panel.webview.html = htmlContent;
        console.log(`[7] Set webview HTML: ${Date.now() - t7}ms`);

        console.log(`=== Total Update Time: ${Date.now() - overallStart}ms ===\n`);
    }

    private _getHtmlContent(
        runs: RunScanResult[],
        selectedRunIds: string[],
        mergedMetrics: { training: MergedMetric[], system: MergedMetric[] }
    ): string {
        const selectedSet = new Set(selectedRunIds);
        const selectedRuns = runs.filter(run => selectedSet.has(run.runId));
        const configComparisonHtml = this._generateConfigComparisonHtml(selectedRuns);
        const comparisonGroupsHtml = this._generateComparisonGroupsHtml(
            runs,
            selectedSet
        );

        // Generate sidebar run list
        const runListHtml = runs.map(run => {
            const isSelected = selectedSet.has(run.runId);
            const color = this._manager.getRunColor(run.runId);
            const contentStatus = this._manager.getRunContentStatus(run.runId);
            const isEmpty = contentStatus === 'empty';
            const isLikelyRunning = run.fileSize > 7 &&
                Date.now() - run.lastModified <= RUN_ACTIVITY_WINDOW_MS;
            const tooltip = isEmpty
                ? `${run.runName}\nThis run is empty (no run metrics have values; system metrics do not count).`
                : run.runName;
            const syncTitle = run.syncStatus === 'synced'
                ? 'Synced to W&B'
                : run.syncStatus === 'unsynced'
                    ? 'Not synced to W&B'
                    : 'Sync status unknown';
            return `
                <div
                    class="run-item${isEmpty ? ' empty-run' : ''}${isLikelyRunning ? ' running-run' : ''}"
                    data-run-name="${this._escapeHtml(run.runName)}"
                    data-run-id="${this._escapeHtml(run.runId)}"
                    data-run-project="${this._escapeHtml(run.project || '')}"
                    data-created-at="${run.createdAt}"
                    data-updated-at="${run.lastModified}"
                    data-file-size="${run.fileSize}"
                    data-content-status="${contentStatus}"
                    oncontextmenu="openRunContextMenu(event, this)"
                >
                    <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleRun(this.closest('.run-item').dataset.runId, this.checked)">
                    <div class="run-color" style="background: ${color}"></div>
                    <div class="run-info">
                        <div class="run-name-row">
                            <span class="run-activity" title="Recently updated; likely still running" aria-label="Likely running">●</span>
                            <div class="run-name" title="${this._escapeHtml(tooltip)}" onclick="focusRunFromSidebar(event, this.closest('.run-item').dataset.runId)">${this._escapeHtml(run.runName)}</div>
                        </div>
                        <div class="run-meta">
                            <span class="sync-status ${run.syncStatus}" title="${syncTitle}" aria-label="${syncTitle}">☁</span>
                            <span>ID: ${this._escapeHtml(run.runId)}</span>
                            <span class="run-created" title="${this._escapeHtml(this._formatTimestamp(run.createdAt))}">· ${this._escapeHtml(this._formatShortTimestamp(run.createdAt))}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Generate metadata HTML
        const metadataHtml = selectedRuns.map(run => {
            const parsedData = this._manager.getParsedData(run.runId);
            const config = parsedData?.config || {};
            const configEntries = Object.entries(config);

            return `
                <div class="metadata-section" data-run-id="${this._escapeHtml(run.runId)}">
                    <div class="metadata-header" onclick="toggleMetadata(this)">
                        <span class="metadata-run-name">${this._escapeHtml(run.runName)}</span>
                        <span class="metadata-toggle">▼</span>
                    </div>
                    <div class="metadata-content">
                        <div class="config-grid">
                            <div class="config-item">
                                <span class="config-key">Created:</span>
                                <span class="config-value">${this._escapeHtml(this._formatTimestamp(run.createdAt))}</span>
                            </div>
                            ${configEntries.map(([key, value]) => `
                                <div class="config-item">
                                    <span class="config-key">${this._escapeHtml(key)}:</span>
                                    <span class="config-value">${this._formatConfigValue(value)}</span>
                                </div>
                            `).join('')}
                        </div>
                        ${configEntries.length === 0 ? `
                            <div class="no-config">No configuration data</div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bread Wandb Viewer</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js"></script>
    <style>
        ${this._getPageStyles()}
        ${getChartStyles()}
    </style>
</head>
<body>
    <div class="container">
        <button class="expand-btn" id="expandBtn" onclick="toggleSidebar()">▶</button>
        <button class="collapse-btn" id="collapseBtn" onclick="toggleSidebar()">◀</button>

        <div class="sidebar" id="sidebar">
            <div class="resize-handle" id="resizeHandle"></div>

            <div class="sidebar-header">
                <h3 id="runCountHeading">Runs (${runs.length})</h3>
                <div class="sidebar-controls">
                    <button class="btn-icon" onclick="selectAllRuns()" title="Select All">☑</button>
                    <button class="btn-icon" onclick="deselectAllRuns()" title="Deselect All">☐</button>
                    <button class="btn-icon rediscover-runs-btn" id="rediscoverRunsBtn" onclick="rediscoverRuns()" title="Search the opened directory for new runs">↻ Rediscover</button>
                </div>
            </div>

            <div class="sidebar-tabs">
                <button class="sidebar-tab active" data-sidebar-tab="runs" onclick="switchSidebarTab('runs')">Runs</button>
                <button class="sidebar-tab" data-sidebar-tab="metadata" onclick="switchSidebarTab('metadata')">Metadata</button>
            </div>

            <div class="sidebar-content active" id="runsContent">
                <div class="run-list-tools">
                    <input type="search" id="runFilterInput" placeholder="Filter runs (glob)…" aria-label="Filter runs by glob pattern over name, ID, or project">
                    <select id="runSortSelect" aria-label="Sort runs">
                        ${this._getRunSortOptionsHtml()}
                    </select>
                    <button
                        type="button"
                        class="run-empty-filter"
                        id="hideEmptyRunsBtn"
                        aria-pressed="false"
                        title="Hide runs confirmed to have no run metric values"
                    >Hide empty</button>
                </div>
                <div id="runList">${runListHtml}</div>
                <div class="run-filter-empty" id="runFilterEmpty">No runs match this filter.</div>
                <section class="comparison-groups-section" aria-label="Comparison groups">
                    <div class="comparison-groups-header">
                        <div>
                            <h4>Comparison groups</h4>
                            <span>Saved in ${this._escapeHtml(RUN_COMPARISON_GROUPS_FILE)}</span>
                        </div>
                        <button type="button" class="btn-icon" onclick="createComparisonGroup()" title="Create comparison group" aria-label="Create comparison group">＋</button>
                    </div>
                    <div id="comparisonGroupList">
                        ${comparisonGroupsHtml || '<div class="comparison-groups-empty">No groups yet.</div>'}
                    </div>
                </section>
            </div>

            <div class="sidebar-content" id="metadataContent">
                ${metadataHtml || '<div class="no-data">Select runs to view metadata</div>'}
            </div>
        </div>

        <div class="main-content">
            <div class="controls-bar-wrapper">
                <span class="logo" role="img" aria-label="Sparkles">✨</span>
                ${getControlsBarHtml(`
                    <div class="control-group">
                        <button class="toggle-btn reload-runs-btn" id="reloadRunsBtn" onclick="reloadSelectedRuns('reloadRunsBtn')" title="Reload data for selected runs" ${selectedRunIds.length === 0 ? 'disabled' : ''}>⟳ Reload runs</button>
                        <button class="toggle-btn sync-runs-btn" id="syncRunsBtn" onclick="syncSelectedRuns()" title="Upload selected runs using the local wandb CLI" ${selectedRunIds.length === 0 ? 'disabled' : ''}>☁ Sync selected</button>
                    </div>
                `)}
            </div>

            <div class="tabs">
                <button class="tab active" data-tab="training">Training Metrics</button>
                <button class="tab" data-tab="system">System Metrics</button>
                <button class="tab" data-tab="configComparison">Compare Configs</button>
            </div>

            <div id="training" class="tab-content active">
                ${this._generateMetricsHtml(mergedMetrics.training, 'training')}
            </div>

            <div id="system" class="tab-content">
                ${this._generateMetricsHtml(mergedMetrics.system, 'system')}
            </div>

            <div id="configComparison" class="tab-content">
                ${configComparisonHtml}
            </div>
        </div>
    </div>

    <div class="run-context-menu" id="runContextMenu" role="menu" aria-hidden="true">
        <button type="button" role="menuitem" onclick="runContextAction('copy')">Copy run ID</button>
        <button type="button" role="menuitem" onclick="runContextAction('isolate')">Show only this run</button>
        <button type="button" role="menuitem" onclick="runContextAction('addToGroup')">Add to comparison group…</button>
        <button type="button" role="menuitem" onclick="runContextAction('rename')">Set custom run name…</button>
        <button type="button" role="menuitem" onclick="runContextAction('sync')">Sync this run</button>
    </div>

        ${getModalHtml(`
        <button class="toggle-btn reload-runs-btn" id="modalReloadRunsBtn" onclick="reloadSelectedRuns('modalReloadRunsBtn')" title="Reload data for selected runs" ${selectedRunIds.length === 0 ? 'disabled' : ''}>⟳ Reload runs</button>
        <button class="toggle-btn sync-runs-btn" id="modalSyncRunsBtn" onclick="syncSelectedRuns()" title="Upload selected runs using the local wandb CLI" ${selectedRunIds.length === 0 ? 'disabled' : ''}>☁ Sync selected</button>
    `)}

    <script>
        ${getChartScript()}
        ${this._generateChartInitScript(mergedMetrics)}
    </script>
</body>
</html>`;
    }

    private _generateComparisonGroupsHtml(
        runs: RunScanResult[],
        selectedRunIds: Set<string>
    ): string {
        const runsById = new Map(runs.map(run => [run.runId, run]));
        return this._comparisonGroups.map(group => {
            const knownRunIds = group.runIds.filter(runId => runsById.has(runId));
            const allKnownRunsSelected = knownRunIds.length > 0 &&
                knownRunIds.every(runId => selectedRunIds.has(runId));
            const memberNames = group.runIds.slice(0, 20).map(runId => {
                const run = runsById.get(runId);
                return run ? run.runName : runId;
            });
            if (group.runIds.length > memberNames.length) {
                memberNames.push(`…and ${group.runIds.length - memberNames.length} more`);
            }
            const unavailableCount = group.runIds.length - knownRunIds.length;
            const countLabel = unavailableCount > 0
                ? `${knownRunIds.length}/${group.runIds.length} open`
                : `${group.runIds.length} run${group.runIds.length === 1 ? '' : 's'}`;

            return `
                <div
                    class="comparison-group-item"
                    data-group-id="${this._escapeHtml(group.id)}"
                    data-run-ids="${this._escapeHtml(JSON.stringify(knownRunIds))}"
                    title="${this._escapeHtml(memberNames.join('\n'))}"
                >
                    <input
                        type="checkbox"
                        class="comparison-group-toggle"
                        ${allKnownRunsSelected ? 'checked' : ''}
                        ${knownRunIds.length === 0 ? 'disabled' : ''}
                        onchange="toggleComparisonGroup(this.closest('.comparison-group-item'), this.checked)"
                        aria-label="Toggle ${this._escapeHtml(group.name)}"
                    >
                    <div class="comparison-group-info">
                        <div class="comparison-group-name">${this._escapeHtml(group.name)}</div>
                        <div class="comparison-group-count">${countLabel}</div>
                    </div>
                    <button type="button" class="comparison-group-action" onclick="editComparisonGroup(this.closest('.comparison-group-item'))" title="Edit group" aria-label="Edit ${this._escapeHtml(group.name)}">✎</button>
                    <button type="button" class="comparison-group-action danger" onclick="deleteComparisonGroup(this.closest('.comparison-group-item'))" title="Delete group" aria-label="Delete ${this._escapeHtml(group.name)}">×</button>
                </div>
            `;
        }).join('');
    }

    private _generateConfigComparisonHtml(selectedRuns: RunScanResult[]): string {
        if (selectedRuns.length < 2) {
            return '<div class="config-compare-empty">Select at least two runs to compare configurations.</div>';
        }

        const runConfigs = new Map<string, Record<string, any>>();
        for (const run of selectedRuns) {
            runConfigs.set(
                run.runId,
                this._manager.getParsedData(run.runId)?.config || {}
            );
        }

        const comparison = compareConfigs(runConfigs);
        const differenceKeys = Object.keys(comparison.differences)
            .sort((a, b) => a.localeCompare(b));
        const commonKeys = Object.keys(comparison.common)
            .sort((a, b) => a.localeCompare(b));
        const parameterHeaders = [
            ...differenceKeys.map((key, index) => `
                <th scope="col" class="config-different-column" data-config-key="${this._escapeHtml(key)}" data-config-group="different" data-config-column-index="${index}">${this._escapeHtml(key)}</th>
            `),
            ...commonKeys.map((key, index) => `
                <th scope="col" class="config-common-column ${index === 0 ? 'config-common-start' : ''}" data-config-key="${this._escapeHtml(key)}" data-config-group="common" data-config-column-index="${differenceKeys.length + index}">${this._escapeHtml(key)}</th>
            `)
        ].join('');
        const runRows = selectedRuns.map(run => {
            const runColor = this._manager.getRunColor(run.runId);
            const differenceCells = differenceKeys.map((key, index) => {
                const values = comparison.differences[key];
                const hasValue = Object.prototype.hasOwnProperty.call(values, run.runId);
                return `<td data-config-group="different" data-config-column-index="${index}">${hasValue
                    ? this._formatConfigComparisonValue(values[run.runId])
                    : '<span class="config-missing">Not set</span>'}</td>`;
            }).join('');
            const commonCells = commonKeys.map((key, index) => `
                <td class="config-common-column ${index === 0 ? 'config-common-start' : ''}" data-config-group="common" data-config-column-index="${differenceKeys.length + index}">
                    ${this._formatConfigComparisonValue(comparison.common[key])}
                </td>
            `).join('');

            return `
            <tr
                data-run-id="${this._escapeHtml(run.runId)}"
                data-run-name="${this._escapeHtml(run.runName)}"
                data-created-at="${run.createdAt}"
                data-updated-at="${run.lastModified}"
            >
                <th scope="row" class="config-run-column">
                    <span class="config-compare-run-heading">
                        <span class="config-compare-run-color" style="background: ${runColor}"></span>
                        <span>
                            <span class="config-compare-run-name">${this._escapeHtml(run.runName)}</span>
                            <span class="config-compare-run-id">${this._escapeHtml(run.runId)}</span>
                        </span>
                    </span>
                </th>
                ${differenceCells}
                ${commonCells}
            </tr>
            `;
        }).join('');

        return `
            <div class="config-compare-view">
                <div class="config-compare-title-row">
                    <div>
                        <h2>Configuration comparison</h2>
                        <div class="config-compare-summary">
                            ${selectedRuns.length} runs ·
                            ${comparison.metadata.differingCount} differing ·
                            ${comparison.metadata.commonCount} common
                        </div>
                    </div>
                    ${parameterHeaders
                        ? `
                            <div class="config-compare-tools">
                                <input type="search" id="configFilterInput" class="config-filter-input" placeholder="Filter parameters…" aria-label="Filter configuration parameters">
                                <select id="configRunSortSelect" class="config-sort-select" aria-label="Sort configuration comparison runs">
                                    ${this._getRunSortOptionsHtml('Runs: ')}
                                </select>
                                <select id="configColumnSortSelect" class="config-sort-select" aria-label="Sort configuration parameters">
                                    <option value="differences-first">Columns: differences first</option>
                                    <option value="common-first">Columns: common first</option>
                                    <option value="key-asc">Columns: parameter A–Z</option>
                                    <option value="key-desc">Columns: parameter Z–A</option>
                                </select>
                            </div>
                        `
                        : ''}
                </div>
                ${parameterHeaders ? `
                    <div class="config-compare-table-wrapper" id="configCompareTableWrapper">
                        <table class="config-compare-table" id="configCompareTable">
                            <thead>
                                <tr class="config-parameter-groups" id="configParameterGroupRow">
                                    <th scope="col" rowspan="2" class="config-run-column">Run</th>
                                    ${differenceKeys.length > 0
                                        ? `<th scope="colgroup" colspan="${differenceKeys.length}" class="config-different-group" id="configDifferentGroup">Differing parameters</th>`
                                        : ''}
                                    ${commonKeys.length > 0
                                        ? `<th scope="colgroup" colspan="${commonKeys.length}" class="config-common-group config-common-start" id="configCommonGroup">Common parameters</th>`
                                        : ''}
                                    <th scope="colgroup" colspan="${differenceKeys.length + commonKeys.length}" id="configAllGroup" hidden>Parameters</th>
                                </tr>
                                <tr id="configParameterHeaderRow">${parameterHeaders}</tr>
                            </thead>
                            <tbody>${runRows}</tbody>
                        </table>
                    </div>
                    <div class="config-compare-empty" id="configFilterEmpty" hidden>No parameters match this filter.</div>
                ` : '<div class="config-compare-empty">The selected runs do not contain configuration parameters.</div>'}
            </div>
        `;
    }

    private _generateMetricsHtml(metrics: MergedMetric[], type: string): string {
        if (metrics.length === 0) {
            return '<div class="no-data">No metrics found</div>';
        }

        // Group metrics by their prefix (like single-run viewer)
        const groups = this._groupMetrics(metrics);

        return groups.map(group => `
            <div class="metric-group">
                <h3>${group.name}</h3>
                <div class="charts-grid">
                    ${group.metrics.map(metric => `
                        <div class="chart-container" data-chart-type="${type}" data-metric-name="${this._escapeHtml(metric.metricName)}">
                            <div class="chart-header">
                                <div class="chart-title">${this._escapeHtml(metric.metricName)}</div>
                                <div class="chart-actions">
                                    <button class="btn-small btn-copy-chart" onclick="copySingleChart('${type}', ${metric.index})" title="Copy chart to clipboard">📋</button>
                                    <button class="btn-small" onclick="openFullscreen(${metric.index}, '${type}')">⛶</button>
                                </div>
                            </div>
                            <div class="chart-wrapper">
                                <canvas id="chart-${type}-${metric.index}" data-chart-type="${type}" data-chart-index="${metric.index}" data-metric-name="${this._escapeHtml(metric.metricName)}"></canvas>
                            </div>
                            <div
                                class="chart-resize-handle"
                                role="separator"
                                aria-label="Resize ${this._escapeHtml(metric.metricName)} chart"
                                aria-orientation="horizontal"
                                aria-valuemin="160"
                                aria-valuemax="1200"
                                aria-valuenow="200"
                                tabindex="0"
                                title="Drag to resize chart height; use arrow keys when focused"
                            ></div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    }

    private _groupMetrics(metrics: MergedMetric[]): Array<{ name: string, metrics: Array<MergedMetric & { index: number }> }> {
        const groups: { [key: string]: Array<MergedMetric & { index: number }> } = {};

        metrics.forEach((metric, index) => {
            const groupName = this._extractGroupName(metric.metricName);
            if (!groups[groupName]) {
                groups[groupName] = [];
            }
            groups[groupName].push({ ...metric, index });
        });

        // Sort groups by priority
        const sortedGroupNames = Object.keys(groups).sort((a, b) => {
            const priority = ['loss', 'accuracy', 'lr', 'optim', 'perf', 'time', 'step'];
            const aIdx = priority.findIndex(p => a.toLowerCase().startsWith(p));
            const bIdx = priority.findIndex(p => b.toLowerCase().startsWith(p));

            if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
            if (aIdx !== -1) return -1;
            if (bIdx !== -1) return 1;

            const aIsGpu = a.toLowerCase().startsWith('gpu');
            const bIsGpu = b.toLowerCase().startsWith('gpu');
            if (aIsGpu && bIsGpu) return a.localeCompare(b);
            if (aIsGpu) return 1;
            if (bIsGpu) return 1;

            return a.localeCompare(b);
        });

        return sortedGroupNames.map(name => ({
            name,
            metrics: groups[name]
        }));
    }

    private _extractGroupName(key: string): string {
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

    private _generateChartInitScript(mergedMetrics: { training: MergedMetric[], system: MergedMetric[] }): string {
        return `
            const vscode = acquireVsCodeApi();
            let trainingMetrics = ${JSON.stringify(mergedMetrics.training)};
            let systemMetrics = ${JSON.stringify(mergedMetrics.system)};
            let activeFullscreenMetric = null;
            let fullscreenRenderToken = 0;
            const MIN_CHART_HEIGHT = 160;
            const MAX_CHART_HEIGHT = 1200;
            const DEFAULT_CHART_HEIGHT = 200;
            const persistedViewState = vscode.getState() || {};
            let focusedRunId = typeof persistedViewState.focusedRunId === 'string'
                ? persistedViewState.focusedRunId
                : null;
            const savedChartHeights = persistedViewState.chartHeights &&
                typeof persistedViewState.chartHeights === 'object'
                ? persistedViewState.chartHeights
                : {};

            function updatePersistedViewState(changes) {
                vscode.setState({
                    ...(vscode.getState() || {}),
                    ...changes
                });
            }

            // Sidebar resizing
            let isResizing = false;
            const resizeHandle = document.getElementById('resizeHandle');
            const sidebar = document.getElementById('sidebar');
            const collapseBtn = document.getElementById('collapseBtn');
            const expandBtn = document.getElementById('expandBtn');

            const savedSidebarWidth = Number(persistedViewState.sidebarWidth);
            if (
                Number.isFinite(savedSidebarWidth) &&
                savedSidebarWidth >= 200 &&
                savedSidebarWidth <= 600
            ) {
                sidebar.style.flex = '0 0 ' + savedSidebarWidth + 'px';
            }

            function setSidebarCollapsed(isCollapsed, shouldPersist = true) {
                sidebar.classList.toggle('collapsed', isCollapsed);
                collapseBtn.style.display = isCollapsed ? 'none' : 'block';
                expandBtn.style.display = isCollapsed ? 'block' : 'none';
                if (!isCollapsed) {
                    updateCollapseButtonPosition();
                }
                if (shouldPersist) {
                    updatePersistedViewState({ sidebarCollapsed: isCollapsed });
                }
            }

            function updateCollapseButtonPosition() {
                const sidebarWidth = sidebar.getBoundingClientRect().width;
                if (sidebarWidth > 0) {
                    collapseBtn.style.left = (sidebarWidth - 10) + 'px';
                }
            }

            resizeHandle.addEventListener('mousedown', (e) => {
                isResizing = true;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
            });

            document.addEventListener('mousemove', (e) => {
                if (!isResizing) return;
                const newWidth = e.clientX;
                if (newWidth >= 200 && newWidth <= 600) {
                    sidebar.style.flex = '0 0 ' + newWidth + 'px';
                    updateCollapseButtonPosition();
                }
            });

            document.addEventListener('mouseup', () => {
                if (isResizing) {
                    isResizing = false;
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    const width = Math.round(sidebar.getBoundingClientRect().width);
                    updatePersistedViewState({ sidebarWidth: width });
                }
            });

            // Initialize button position
            setSidebarCollapsed(
                persistedViewState.sidebarCollapsed === true,
                false
            );
            updateCollapseButtonPosition();

            // Run filtering and sorting
            const runFilterInput = document.getElementById('runFilterInput');
            const runSortSelect = document.getElementById('runSortSelect');
            const hideEmptyRunsBtn = document.getElementById('hideEmptyRunsBtn');
            const runList = document.getElementById('runList');
            const runFilterEmpty = document.getElementById('runFilterEmpty');
            const runCountHeading = document.getElementById('runCountHeading');
            const RUN_ACTIVITY_WINDOW_MS = ${RUN_ACTIVITY_WINDOW_MS};

            function updateRunActivityIndicators(lastModifiedByRunId) {
                document.querySelectorAll('.run-item[data-run-id]').forEach(item => {
                    const updatedAt = lastModifiedByRunId?.[item.dataset.runId];
                    if (Number.isFinite(Number(updatedAt))) {
                        item.dataset.updatedAt = String(updatedAt);
                    }
                    const lastModified = Number(item.dataset.updatedAt);
                    const fileSize = Number(item.dataset.fileSize);
                    const isLikelyRunning = Number.isFinite(lastModified) &&
                        fileSize > 7 &&
                        Date.now() - lastModified <= RUN_ACTIVITY_WINDOW_MS;
                    item.classList.toggle('running-run', isLikelyRunning);
                });
            }

            function globToRegExp(globPattern) {
                const regexPattern = Array.from(globPattern).map(character => {
                    if (character === '*') return '.*';
                    if (character === '?') return '.';
                    const isRegexSpecial = '^$+.()|{}[]'.includes(character) ||
                        character.charCodeAt(0) === 92;
                    return isRegexSpecial
                        ? String.fromCharCode(92) + character
                        : character;
                }).join('');
                return new RegExp(regexPattern, 'i');
            }

            function applyRunListView(shouldPersist = true) {
                if (!runFilterInput || !runSortSelect || !runList) return;

                const filterText = runFilterInput.value.trim();
                const filterPattern = globToRegExp(filterText);
                const sortMode = runSortSelect.value;
                const hideEmptyRuns = hideEmptyRunsBtn?.getAttribute('aria-pressed') === 'true';
                const runItems = Array.from(runList.querySelectorAll('.run-item'));
                const compareText = (a, b) => a.localeCompare(b, undefined, {
                    numeric: true,
                    sensitivity: 'base'
                });
                const getTimestamp = (item, field) => {
                    const value = Number(item.dataset[field]);
                    return Number.isFinite(value) ? value : 0;
                };

                runItems.sort((a, b) => {
                    let result = 0;
                    if (sortMode === 'name-desc') {
                        result = compareText(b.dataset.runName || '', a.dataset.runName || '');
                    } else if (sortMode === 'created-desc') {
                        result = getTimestamp(b, 'createdAt') - getTimestamp(a, 'createdAt');
                    } else if (sortMode === 'created-asc') {
                        result = getTimestamp(a, 'createdAt') - getTimestamp(b, 'createdAt');
                    } else if (sortMode === 'updated-desc') {
                        result = getTimestamp(b, 'updatedAt') - getTimestamp(a, 'updatedAt');
                    } else if (sortMode === 'updated-asc') {
                        result = getTimestamp(a, 'updatedAt') - getTimestamp(b, 'updatedAt');
                    } else {
                        result = compareText(a.dataset.runName || '', b.dataset.runName || '');
                    }

                    return result || compareText(a.dataset.runId || '', b.dataset.runId || '');
                });

                let visibleCount = 0;
                let emptyCount = 0;
                runItems.forEach(item => {
                    const isEmpty = item.dataset.contentStatus === 'empty';
                    if (isEmpty) {
                        emptyCount++;
                    }
                    const searchableText = [
                        item.dataset.runName,
                        item.dataset.runId,
                        item.dataset.runProject
                    ].join(' ');
                    const matchesText = !filterText || filterPattern.test(searchableText);
                    const isVisible = matchesText && (!hideEmptyRuns || !isEmpty);
                    item.hidden = !isVisible;
                    if (isVisible) {
                        visibleCount++;
                    }
                    runList.appendChild(item);
                });

                if (hideEmptyRunsBtn) {
                    hideEmptyRunsBtn.disabled = emptyCount === 0;
                    hideEmptyRunsBtn.classList.toggle('active', hideEmptyRuns);
                    hideEmptyRunsBtn.title = emptyCount === 0
                        ? 'No runs are currently confirmed empty'
                        : hideEmptyRuns
                            ? 'Show runs confirmed to have no run metric values'
                            : 'Hide runs confirmed to have no run metric values';
                }

                if (runFilterEmpty) {
                    runFilterEmpty.classList.toggle('visible', visibleCount === 0);
                }
                if (runCountHeading) {
                    runCountHeading.textContent = visibleCount === runItems.length
                        ? 'Runs (' + runItems.length + ')'
                        : 'Runs (' + visibleCount + '/' + runItems.length + ')';
                }
                if (shouldPersist) {
                    updatePersistedViewState({
                        runFilter: runFilterInput.value,
                        runSort: sortMode,
                        hideEmptyRuns
                    });
                }
            }

            if (runFilterInput && typeof persistedViewState.runFilter === 'string') {
                runFilterInput.value = persistedViewState.runFilter;
            }
            if (
                runSortSelect &&
                typeof persistedViewState.runSort === 'string' &&
                Array.from(runSortSelect.options).some(option =>
                    option.value === persistedViewState.runSort
                )
            ) {
                runSortSelect.value = persistedViewState.runSort;
            }
            if (hideEmptyRunsBtn) {
                hideEmptyRunsBtn.setAttribute(
                    'aria-pressed',
                    persistedViewState.hideEmptyRuns === true ? 'true' : 'false'
                );
            }
            if (runFilterInput) {
                runFilterInput.addEventListener('input', () => applyRunListView());
            }
            if (runSortSelect) {
                runSortSelect.addEventListener('change', () => applyRunListView());
            }
            if (hideEmptyRunsBtn) {
                hideEmptyRunsBtn.addEventListener('click', () => {
                    const isActive = hideEmptyRunsBtn.getAttribute('aria-pressed') === 'true';
                    hideEmptyRunsBtn.setAttribute('aria-pressed', isActive ? 'false' : 'true');
                    applyRunListView();
                });
            }
            applyRunListView(false);
            updateRunActivityIndicators();
            setInterval(updateRunActivityIndicators, 15000);
            if (
                focusedRunId &&
                !Array.from(document.querySelectorAll('.run-item[data-run-id]'))
                    .some(item => item.dataset.runId === focusedRunId)
            ) {
                focusedRunId = null;
                updatePersistedViewState({ focusedRunId: null });
            }
            applyFocusedRun(focusedRunId, false);
            updateComparisonGroupCheckboxes();

            // Configuration-column filtering
            const configFilterInput = document.getElementById('configFilterInput');
            const configRunSortSelect = document.getElementById('configRunSortSelect');
            const configColumnSortSelect = document.getElementById('configColumnSortSelect');
            const configCompareTable = document.getElementById('configCompareTable');
            const configCompareTableWrapper = document.getElementById('configCompareTableWrapper');
            const configFilterEmpty = document.getElementById('configFilterEmpty');
            const configDifferentGroup = document.getElementById('configDifferentGroup');
            const configCommonGroup = document.getElementById('configCommonGroup');
            const configAllGroup = document.getElementById('configAllGroup');
            const configParameterGroupRow = document.getElementById('configParameterGroupRow');
            const configParameterHeaderRow = document.getElementById('configParameterHeaderRow');

            function applyConfigColumnView(shouldPersist = true) {
                if (
                    !configFilterInput ||
                    !configRunSortSelect ||
                    !configColumnSortSelect ||
                    !configCompareTable ||
                    !configParameterHeaderRow
                ) {
                    return;
                }

                const filterText = configFilterInput.value.trim().toLocaleLowerCase();
                const headers = Array.from(
                    configCompareTable.querySelectorAll('th[data-config-key]')
                );
                const columnSortMode = configColumnSortSelect.value;
                const compareKeys = (first, second) =>
                    (first.dataset.configKey || '').localeCompare(
                        second.dataset.configKey || '',
                        undefined,
                        { numeric: true, sensitivity: 'base' }
                    );
                const groupRank = header => {
                    const isCommon = header.dataset.configGroup === 'common';
                    if (columnSortMode === 'common-first') {
                        return isCommon ? 0 : 1;
                    }
                    return isCommon ? 1 : 0;
                };

                headers.sort((first, second) => {
                    if (columnSortMode === 'key-desc') {
                        return compareKeys(second, first);
                    }
                    if (columnSortMode === 'key-asc') {
                        return compareKeys(first, second);
                    }
                    return groupRank(first) - groupRank(second) ||
                        compareKeys(first, second);
                });

                headers.forEach(header => {
                    configParameterHeaderRow.appendChild(header);
                });
                configCompareTable.querySelectorAll('tbody tr').forEach(row => {
                    headers.forEach(header => {
                        const cell = row.querySelector(
                            '[data-config-column-index="' +
                            header.dataset.configColumnIndex +
                            '"]'
                        );
                        if (cell) {
                            row.appendChild(cell);
                        }
                    });
                });

                const configRunRows = Array.from(
                    configCompareTable.querySelectorAll('tbody tr[data-run-id]')
                );
                const compareRunText = (first, second, field) =>
                    (first.dataset[field] || '').localeCompare(
                        second.dataset[field] || '',
                        undefined,
                        { numeric: true, sensitivity: 'base' }
                    );
                const compareRunTimestamp = (first, second, field) => {
                    const firstValue = Number(first.dataset[field]);
                    const secondValue = Number(second.dataset[field]);
                    return (Number.isFinite(firstValue) ? firstValue : 0) -
                        (Number.isFinite(secondValue) ? secondValue : 0);
                };
                const runSortMode = configRunSortSelect.value;
                configRunRows.sort((first, second) => {
                    let result = 0;
                    if (runSortMode === 'name-desc') {
                        result = compareRunText(second, first, 'runName');
                    } else if (runSortMode === 'name-asc') {
                        result = compareRunText(first, second, 'runName');
                    } else if (runSortMode === 'created-asc') {
                        result = compareRunTimestamp(first, second, 'createdAt');
                    } else if (runSortMode === 'updated-desc') {
                        result = compareRunTimestamp(second, first, 'updatedAt');
                    } else if (runSortMode === 'updated-asc') {
                        result = compareRunTimestamp(first, second, 'updatedAt');
                    } else {
                        result = compareRunTimestamp(second, first, 'createdAt');
                    }

                    return result || compareRunText(first, second, 'runId');
                });
                const configTableBody = configCompareTable.querySelector('tbody');
                if (configTableBody) {
                    configRunRows.forEach(row => configTableBody.appendChild(row));
                }

                let visibleDifferent = 0;
                let visibleCommon = 0;

                headers.forEach(header => {
                    const isVisible = !filterText ||
                        (header.dataset.configKey || '')
                            .toLocaleLowerCase()
                            .includes(filterText);
                    const columnIndex = header.dataset.configColumnIndex;
                    configCompareTable
                        .querySelectorAll('[data-config-column-index="' + columnIndex + '"]')
                        .forEach(cell => {
                            cell.hidden = !isVisible;
                        });

                    if (isVisible && header.dataset.configGroup === 'common') {
                        visibleCommon++;
                    } else if (isVisible) {
                        visibleDifferent++;
                    }
                });

                if (configDifferentGroup) {
                    configDifferentGroup.colSpan = Math.max(visibleDifferent, 1);
                    configDifferentGroup.hidden = visibleDifferent === 0;
                }
                if (configCommonGroup) {
                    configCommonGroup.colSpan = Math.max(visibleCommon, 1);
                    configCommonGroup.hidden = visibleCommon === 0;
                }

                const groupedSort = columnSortMode === 'differences-first' ||
                    columnSortMode === 'common-first';
                if (configAllGroup) {
                    configAllGroup.colSpan = Math.max(
                        visibleDifferent + visibleCommon,
                        1
                    );
                    configAllGroup.hidden = groupedSort ||
                        visibleDifferent + visibleCommon === 0;
                }
                if (configParameterGroupRow) {
                    if (groupedSort) {
                        const groupElements = columnSortMode === 'common-first'
                            ? [configCommonGroup, configDifferentGroup]
                            : [configDifferentGroup, configCommonGroup];
                        groupElements.forEach(group => {
                            if (group) {
                                configParameterGroupRow.appendChild(group);
                            }
                        });
                        if (configAllGroup) {
                            configParameterGroupRow.appendChild(configAllGroup);
                        }
                    } else {
                        if (configDifferentGroup) configDifferentGroup.hidden = true;
                        if (configCommonGroup) configCommonGroup.hidden = true;
                        if (configAllGroup) {
                            configParameterGroupRow.appendChild(configAllGroup);
                        }
                    }
                }

                configCompareTable
                    .querySelectorAll('[data-config-group="common"]')
                    .forEach(cell => cell.classList.remove('config-common-start'));
                const firstVisibleCommon = groupedSort
                    ? headers.find(header =>
                        !header.hidden && header.dataset.configGroup === 'common'
                    )
                    : null;
                if (firstVisibleCommon) {
                    const columnIndex = firstVisibleCommon.dataset.configColumnIndex;
                    configCompareTable
                        .querySelectorAll('[data-config-column-index="' + columnIndex + '"]')
                        .forEach(cell => cell.classList.add('config-common-start'));
                }

                const hasVisibleColumns = visibleDifferent + visibleCommon > 0;
                if (configCompareTableWrapper) {
                    configCompareTableWrapper.hidden = !hasVisibleColumns;
                }
                if (configFilterEmpty) {
                    configFilterEmpty.hidden = hasVisibleColumns;
                }
                if (shouldPersist) {
                    updatePersistedViewState({
                        configFilter: configFilterInput.value,
                        configRunSort: runSortMode,
                        configSort: columnSortMode
                    });
                }
            }

            if (configFilterInput && typeof persistedViewState.configFilter === 'string') {
                configFilterInput.value = persistedViewState.configFilter;
            }
            if (
                configColumnSortSelect &&
                typeof persistedViewState.configSort === 'string' &&
                Array.from(configColumnSortSelect.options).some(option =>
                    option.value === persistedViewState.configSort
                )
            ) {
                configColumnSortSelect.value = persistedViewState.configSort;
            }
            if (
                configRunSortSelect &&
                typeof persistedViewState.configRunSort === 'string' &&
                Array.from(configRunSortSelect.options).some(option =>
                    option.value === persistedViewState.configRunSort
                )
            ) {
                configRunSortSelect.value = persistedViewState.configRunSort;
            }
            if (configFilterInput) {
                configFilterInput.addEventListener('input', () => applyConfigColumnView());
            }
            if (configRunSortSelect) {
                configRunSortSelect.addEventListener(
                    'change',
                    () => applyConfigColumnView()
                );
            }
            if (configColumnSortSelect) {
                configColumnSortSelect.addEventListener(
                    'change',
                    () => applyConfigColumnView()
                );
            }
            applyConfigColumnView(false);

            // Per-chart height resizing
            function getChartResizeKey(container) {
                return container.dataset.chartType + ':' + container.dataset.metricName;
            }

            function clampChartHeight(height) {
                return Math.min(MAX_CHART_HEIGHT, Math.max(MIN_CHART_HEIGHT, height));
            }

            function resizeChartContainer(container, height) {
                const clampedHeight = Math.round(clampChartHeight(height));
                const wrapper = container.querySelector('.chart-wrapper');
                const handle = container.querySelector('.chart-resize-handle');
                if (!wrapper || !handle) return;

                wrapper.style.height = clampedHeight + 'px';
                handle.setAttribute('aria-valuenow', String(clampedHeight));

                const canvas = wrapper.querySelector('canvas');
                const chart = canvas ? chartInstances[canvas.id] : null;
                if (chart) {
                    chart.resize();
                }
            }

            function saveChartHeight(container) {
                const wrapper = container.querySelector('.chart-wrapper');
                if (!wrapper) return;

                savedChartHeights[getChartResizeKey(container)] = Math.round(
                    wrapper.getBoundingClientRect().height
                );
                updatePersistedViewState({
                    chartHeights: savedChartHeights
                });
            }

            document.querySelectorAll('.chart-container').forEach(container => {
                const savedHeight = Number(savedChartHeights[getChartResizeKey(container)]);
                if (Number.isFinite(savedHeight)) {
                    resizeChartContainer(container, savedHeight);
                }

                const handle = container.querySelector('.chart-resize-handle');
                if (!handle) return;

                handle.addEventListener('pointerdown', event => {
                    if (event.button !== 0) return;

                    const wrapper = container.querySelector('.chart-wrapper');
                    if (!wrapper) return;

                    const startY = event.clientY;
                    const startHeight = wrapper.getBoundingClientRect().height;
                    handle.setPointerCapture(event.pointerId);
                    handle.classList.add('active');
                    document.body.classList.add('chart-resizing');

                    const onPointerMove = moveEvent => {
                        resizeChartContainer(
                            container,
                            startHeight + moveEvent.clientY - startY
                        );
                    };

                    const finishResize = finishEvent => {
                        handle.removeEventListener('pointermove', onPointerMove);
                        handle.removeEventListener('pointerup', finishResize);
                        handle.removeEventListener('pointercancel', finishResize);
                        if (handle.hasPointerCapture(finishEvent.pointerId)) {
                            handle.releasePointerCapture(finishEvent.pointerId);
                        }
                        handle.classList.remove('active');
                        document.body.classList.remove('chart-resizing');
                        saveChartHeight(container);
                    };

                    handle.addEventListener('pointermove', onPointerMove);
                    handle.addEventListener('pointerup', finishResize);
                    handle.addEventListener('pointercancel', finishResize);
                    event.preventDefault();
                });

                handle.addEventListener('keydown', event => {
                    if (
                        event.key !== 'ArrowUp' &&
                        event.key !== 'ArrowDown' &&
                        event.key !== 'Home'
                    ) {
                        return;
                    }

                    const wrapper = container.querySelector('.chart-wrapper');
                    if (!wrapper) return;

                    if (event.key === 'Home') {
                        resizeChartContainer(container, DEFAULT_CHART_HEIGHT);
                    } else {
                        const direction = event.key === 'ArrowDown' ? 1 : -1;
                        const step = event.shiftKey ? 50 : 20;
                        resizeChartContainer(
                            container,
                            wrapper.getBoundingClientRect().height + direction * step
                        );
                    }
                    saveChartHeight(container);
                    event.preventDefault();
                });
            });

            // Sidebar collapse/expand
            function toggleSidebar() {
                setSidebarCollapsed(!sidebar.classList.contains('collapsed'));
            }

            // Sidebar tab switching
            function switchSidebarTab(tab, shouldPersist = true) {
                const tabs = document.querySelectorAll('.sidebar-tab');
                const contents = document.querySelectorAll('.sidebar-content');
                const targetTab = document.querySelector(
                    '[data-sidebar-tab="' + tab + '"]'
                );
                const targetContent = document.getElementById(tab + 'Content');
                if (!targetTab || !targetContent) return;

                tabs.forEach(t => t.classList.remove('active'));
                contents.forEach(c => c.classList.remove('active'));

                targetTab.classList.add('active');
                targetContent.classList.add('active');
                if (shouldPersist) {
                    updatePersistedViewState({ sidebarTab: tab });
                }
            }
            if (
                persistedViewState.sidebarTab === 'runs' ||
                persistedViewState.sidebarTab === 'metadata'
            ) {
                switchSidebarTab(persistedViewState.sidebarTab, false);
            }

            // Metadata toggling
            function toggleMetadata(header) {
                const section = header.parentElement;
                section.classList.toggle('collapsed');
            }

            // Run selection
            function isFullscreenCurrentlyOpen() {
                return document.getElementById('fullscreenModal')?.classList.contains('active') === true;
            }

            function setOptimisticRunSelection(runId, selected) {
                const runItem = Array.from(
                    document.querySelectorAll('.run-item[data-run-id]')
                ).find(item => item.dataset.runId === runId);
                if (!runItem) return;

                const checkbox = runItem.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    checkbox.checked = selected;
                }
                runItem.classList.add('selection-loading');
                updateComparisonGroupCheckboxes();
            }

            function setOptimisticBulkSelection(selectedRunIds) {
                const selectedSet = new Set(selectedRunIds);
                document.querySelectorAll('.run-item[data-run-id]').forEach(item => {
                    const checkbox = item.querySelector('input[type="checkbox"]');
                    if (checkbox) {
                        checkbox.checked = selectedSet.has(item.dataset.runId);
                    }
                    item.classList.add('selection-loading');
                });
                updateComparisonGroupCheckboxes();
            }

            function getComparisonGroupRunIds(groupItem) {
                if (!groupItem) return [];
                try {
                    const runIds = JSON.parse(groupItem.dataset.runIds || '[]');
                    return Array.isArray(runIds)
                        ? runIds.filter(runId => typeof runId === 'string')
                        : [];
                } catch {
                    return [];
                }
            }

            function updateComparisonGroupCheckboxes() {
                const selectedRunIds = new Set(
                    Array.from(
                        document.querySelectorAll('.run-item[data-run-id]'),
                        item => {
                            const checkbox = item.querySelector('input[type="checkbox"]');
                            return checkbox?.checked ? item.dataset.runId : null;
                        }
                    ).filter(Boolean)
                );
                document.querySelectorAll('.comparison-group-item').forEach(groupItem => {
                    const runIds = getComparisonGroupRunIds(groupItem);
                    const checkbox = groupItem.querySelector('.comparison-group-toggle');
                    if (!checkbox) return;
                    const selectedCount = runIds.filter(runId => selectedRunIds.has(runId)).length;
                    checkbox.checked = runIds.length > 0 && selectedCount === runIds.length;
                    checkbox.indeterminate = selectedCount > 0 && selectedCount < runIds.length;
                    checkbox.disabled = runIds.length === 0;
                });
            }

            function toggleComparisonGroup(groupItem, selected) {
                const runIds = getComparisonGroupRunIds(groupItem);
                runIds.forEach(runId => setOptimisticRunSelection(runId, selected));
                updateComparisonGroupCheckboxes();
                vscode.postMessage({
                    command: 'toggleComparisonGroup',
                    groupId: groupItem.dataset.groupId,
                    selected,
                    fullscreenOpen: isFullscreenCurrentlyOpen()
                });
            }

            function createComparisonGroup() {
                vscode.postMessage({ command: 'createComparisonGroup' });
            }

            function editComparisonGroup(groupItem) {
                vscode.postMessage({
                    command: 'editComparisonGroup',
                    groupId: groupItem.dataset.groupId
                });
            }

            function deleteComparisonGroup(groupItem) {
                vscode.postMessage({
                    command: 'deleteComparisonGroup',
                    groupId: groupItem.dataset.groupId
                });
            }

            function applyFocusedRun(runId, shouldPersist = true) {
                focusedRunId = typeof runId === 'string' && runId ? runId : null;
                document.querySelectorAll('.run-item[data-run-id]').forEach(item => {
                    item.classList.toggle(
                        'focused-run',
                        focusedRunId !== null && item.dataset.runId === focusedRunId
                    );
                });
                Object.values(chartInstances).forEach(chart => {
                    setFocusedRun(chart, focusedRunId);
                });
                if (modalChart) {
                    setFocusedRun(modalChart, focusedRunId);
                }
                if (shouldPersist) {
                    updatePersistedViewState({ focusedRunId });
                }
            }

            function focusRunFromSidebar(event, runId) {
                event.preventDefault();
                event.stopPropagation();
                applyFocusedRun(focusedRunId === runId ? null : runId);
            }

            function toggleRun(runId, selected) {
                setOptimisticRunSelection(runId, selected);
                vscode.postMessage({
                    command: 'toggleRun',
                    runId,
                    selected,
                    fullscreenOpen: isFullscreenCurrentlyOpen()
                });
            }

            function selectAllRuns() {
                const runIds = Array.from(
                    document.querySelectorAll('.run-item[data-run-id]'),
                    item => item.dataset.runId
                );
                setOptimisticBulkSelection(runIds);
                vscode.postMessage({
                    command: 'selectAll',
                    fullscreenOpen: isFullscreenCurrentlyOpen()
                });
            }

            function deselectAllRuns() {
                setOptimisticBulkSelection([]);
                vscode.postMessage({
                    command: 'deselectAll',
                    fullscreenOpen: isFullscreenCurrentlyOpen()
                });
            }

            const runContextMenu = document.getElementById('runContextMenu');
            let contextRunId = null;

            function hideRunContextMenu() {
                if (!runContextMenu) return;
                runContextMenu.classList.remove('visible');
                runContextMenu.setAttribute('aria-hidden', 'true');
                contextRunId = null;
            }

            function openRunContextMenu(event, runItem) {
                if (!runContextMenu || !runItem || !runItem.dataset.runId) return;
                event.preventDefault();
                event.stopPropagation();
                contextRunId = runItem.dataset.runId;
                runContextMenu.classList.add('visible');
                runContextMenu.setAttribute('aria-hidden', 'false');

                const menuRect = runContextMenu.getBoundingClientRect();
                const left = Math.min(event.clientX, window.innerWidth - menuRect.width - 8);
                const top = Math.min(event.clientY, window.innerHeight - menuRect.height - 8);
                runContextMenu.style.left = Math.max(8, left) + 'px';
                runContextMenu.style.top = Math.max(8, top) + 'px';
            }

            function runContextAction(action) {
                const runId = contextRunId;
                hideRunContextMenu();
                if (!runId) return;

                if (action === 'copy') {
                    vscode.postMessage({ command: 'copyRunId', runId });
                } else if (action === 'isolate') {
                    setOptimisticBulkSelection([runId]);
                    vscode.postMessage({
                        command: 'showOnlyRun',
                        runId,
                        fullscreenOpen: isFullscreenCurrentlyOpen()
                    });
                } else if (action === 'addToGroup') {
                    vscode.postMessage({
                        command: 'addRunToComparisonGroup',
                        runId
                    });
                } else if (action === 'rename') {
                    vscode.postMessage({ command: 'renameRun', runId });
                } else if (action === 'sync') {
                    setSyncButtonsBusy(true);
                    vscode.postMessage({ command: 'syncRuns', runIds: [runId] });
                }
            }

            document.addEventListener('click', event => {
                if (runContextMenu && !runContextMenu.contains(event.target)) {
                    hideRunContextMenu();
                }
            });
            document.addEventListener('scroll', hideRunContextMenu, true);
            window.addEventListener('blur', hideRunContextMenu);

            function setSyncButtonsBusy(isBusy, canSync = true) {
                ['syncRunsBtn', 'modalSyncRunsBtn'].forEach(buttonId => {
                    const button = document.getElementById(buttonId);
                    if (!button) return;
                    button.textContent = isBusy ? '☁ Syncing…' : '☁ Sync selected';
                    button.disabled = isBusy || !canSync;
                    button.toggleAttribute('aria-busy', isBusy);
                });
            }

            function syncSelectedRuns() {
                setSyncButtonsBusy(true);
                vscode.postMessage({ command: 'syncRuns' });
            }

            function reloadSelectedRuns(buttonId) {
                const button = document.getElementById(buttonId);
                if (!button || button.disabled) return;

                button.disabled = true;
                button.textContent = '⟳ Reloading…';
                button.setAttribute('aria-busy', 'true');
                vscode.postMessage({ command: 'reloadSelectedRuns' });
            }

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'syncRunsComplete') {
                    setSyncButtonsBusy(false, message.canSync);
                    return;
                }
                if (message.command !== 'reloadSelectedRunsComplete') return;

                ['reloadRunsBtn', 'modalReloadRunsBtn'].forEach(buttonId => {
                    const button = document.getElementById(buttonId);
                    if (!button) return;

                    button.textContent = '⟳ Reload runs';
                    button.disabled = !message.canReload;
                    button.removeAttribute('aria-busy');
                });

            });

            function rediscoverRuns() {
                const button = document.getElementById('rediscoverRunsBtn');
                if (!button || button.disabled) return;

                button.disabled = true;
                button.textContent = '↻ Discovering…';
                button.setAttribute('aria-busy', 'true');
                vscode.postMessage({ command: 'rediscoverRuns' });
            }

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command !== 'rediscoverRunsComplete') return;

                const button = document.getElementById('rediscoverRunsBtn');
                if (!button) return;

                button.textContent = '↻ Rediscover';
                button.disabled = false;
                button.removeAttribute('aria-busy');
            });

            function createRunDatasets(metric, isModal) {
                return metric.datasets.map(dataset => ({
                    label: dataset.runName,
                    data: dataset.data.map(d => ({ x: d.step, y: d.value })),
                    borderColor: dataset.color,
                    backgroundColor: dataset.color + '20',
                    fill: false,
                    tension: 0.1,
                    pointRadius: dataset.data.length > (isModal ? 100 : 50) ? 0 : (isModal ? 3 : 2),
                    pointHoverRadius: isModal ? 5 : 4,
                    pointBackgroundColor: dataset.color + '59',
                    pointBorderColor: dataset.color + '99',
                    borderWidth: 2,
                    _originalData: dataset.data.map(d => ({ x: d.step, y: d.value })),
                    _originalColor: dataset.color,
                    _runName: dataset.runName,
                    _runId: dataset.runId,
                    _isOriginal: true
                }));
            }

            function updateChartData(chart, metric, isModal) {
                if (!chart) return;
                const runVisibility = getRunVisibility(chart);

                if (!metric) {
                    chart.data.datasets = [];
                    chart.update('none');
                    return;
                }

                const datasets = createRunDatasets(metric, isModal);
                const maxPoints = Math.max(
                    ...datasets.map(dataset => dataset.data.length),
                    0
                );
                chart.options.plugins.decimation.enabled = maxPoints > 500;
                chart.data.datasets = datasets;
                applyRunVisibility(chart, runVisibility);

                const smoothing = isModal
                    ? parseFloat(document.getElementById('modalSmoothing').value)
                    : globalSmoothing;
                updateChartSmoothing(chart, smoothing, isModal ? modalShowRaw : showRaw);
            }

            function ensureOverviewChart(metric, type) {
                const canvas = Array.from(
                    document.querySelectorAll('canvas[id^="chart-"]')
                ).find(candidate =>
                    candidate.dataset.chartType === type &&
                    candidate.dataset.metricName === metric.metricName
                );
                if (!canvas) return null;

                if (!chartInstances[canvas.id]) {
                    chartInstances[canvas.id] = createUnifiedChart(
                        canvas,
                        createRunDatasets(metric, false),
                        metric.metricName,
                        { isModal: false, enableZoom: true }
                    );
                    updateChartSmoothing(
                        chartInstances[canvas.id],
                        globalSmoothing,
                        showRaw
                    );
                    if (focusedRunId) {
                        setFocusedRun(chartInstances[canvas.id], focusedRunId);
                    }
                    chartObserver.unobserve(canvas);
                }

                return chartInstances[canvas.id];
            }

            function updateRunColorSwatches(runColors) {
                if (!runColors || typeof runColors !== 'object') return;

                document.querySelectorAll('.run-item[data-run-id]').forEach(item => {
                    const color = runColors[item.dataset.runId];
                    const swatch = item.querySelector('.run-color');
                    if (typeof color === 'string' && swatch) {
                        swatch.style.background = color;
                    }
                });
                document.querySelectorAll(
                    '#configCompareTable tbody tr[data-run-id]'
                ).forEach(row => {
                    const color = runColors[row.dataset.runId];
                    const swatch = row.querySelector('.config-compare-run-color');
                    if (typeof color === 'string' && swatch) {
                        swatch.style.background = color;
                    }
                });
            }

            function updateRunContentStatuses(runContentStatuses) {
                if (!runContentStatuses || typeof runContentStatuses !== 'object') return;

                document.querySelectorAll('.run-item[data-run-id]').forEach(item => {
                    const status = runContentStatuses[item.dataset.runId];
                    if (typeof status !== 'string') return;
                    item.dataset.contentStatus = status;
                    item.classList.toggle('empty-run', status === 'empty');

                    const runName = item.dataset.runName || '';
                    const nameElement = item.querySelector('.run-name');
                    if (nameElement) {
                        nameElement.title = status === 'empty'
                            ? runName + '\\nThis run is empty (no run metrics have values; system metrics do not count).'
                            : runName;
                    }
                });
                applyRunListView(false);
            }

            function updateMergedMetrics(mergedMetrics) {
                trainingMetrics = mergedMetrics.training || [];
                systemMetrics = mergedMetrics.system || [];

                Object.entries(chartInstances).forEach(([canvasId, chart]) => {
                    const canvas = document.getElementById(canvasId);
                    if (!canvas) return;

                    const metrics = canvas.dataset.chartType === 'training'
                        ? trainingMetrics
                        : systemMetrics;
                    const metric = metrics.find(
                        candidate => candidate.metricName === canvas.dataset.metricName
                    );
                    updateChartData(chart, metric, false);
                });

                if (modalChart && activeFullscreenMetric) {
                    const metrics = activeFullscreenMetric.type === 'training'
                        ? trainingMetrics
                        : systemMetrics;
                    const metric = metrics.find(
                        candidate => candidate.metricName === activeFullscreenMetric.metricName
                    );
                    updateChartData(modalChart, metric, true);
                }
            }

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.runLastModified) {
                    updateRunActivityIndicators(message.runLastModified);
                }
                if (message.command === 'runSelectionAcknowledged') {
                    setOptimisticRunSelection(message.runId, message.selected === true);
                    if (message.accepted !== true) {
                        document.querySelectorAll('.run-item.selection-loading')
                            .forEach(item => item.classList.remove('selection-loading'));
                    }
                }
                if (
                    message.command === 'bulkRunSelectionAcknowledged' &&
                    Array.isArray(message.selectedRunIds)
                ) {
                    setOptimisticBulkSelection(message.selectedRunIds);
                }
                if (message.command === 'runSelectionRefreshComplete') {
                    document.querySelectorAll('.run-item.selection-loading')
                        .forEach(item => item.classList.remove('selection-loading'));
                }
                if (message.runContentStatuses) {
                    updateRunContentStatuses(message.runContentStatuses);
                }
                if (
                    (
                        message.command !== 'runDataUpdated' &&
                        message.command !== 'runColorsUpdated'
                    ) ||
                    !message.mergedMetrics
                ) {
                    return;
                }

                if (message.command === 'runColorsUpdated') {
                    updateRunColorSwatches(message.runColors);
                }
                updateMergedMetrics(message.mergedMetrics);
            });

            // Fullscreen modal
            function openFullscreen(metricIndex, type, shouldPersist = true) {
                const metrics = type === 'training' ? trainingMetrics : systemMetrics;
                const metric = metrics[metricIndex];
                if (!metric) return;

                activeFullscreenMetric = {
                    metricName: metric.metricName,
                    type
                };
                vscode.postMessage({
                    command: 'fullscreenStateChanged',
                    open: true
                });
                if (shouldPersist) {
                    updatePersistedViewState({
                        fullscreenMetric: activeFullscreenMetric,
                        fullscreenOpen: true
                    });
                }

                document.getElementById('modalTitle').textContent = metric.metricName;
                document.getElementById('fullscreenModal').classList.add('active');
                document.body.classList.add('modal-open');

                document.getElementById('modalSmoothing').value = 0;
                document.getElementById('modalSmoothingValue').textContent = '0.00';
                document.getElementById('modalShowRawGroup').style.display = 'none';
                modalShowRaw = showRaw;
                document.getElementById('modalShowRawBtn').classList.toggle('active', modalShowRaw);
                modalLogX = logX;
                modalLogY = logY;
                document.getElementById('modalLogXBtn').classList.toggle('active', modalLogX);
                document.getElementById('modalLogYBtn').classList.toggle('active', modalLogY);

                const renderToken = ++fullscreenRenderToken;
                if (modalChart) {
                    modalChart.destroy();
                    modalChart = null;
                }

                requestAnimationFrame(() => {
                    const modal = document.getElementById('fullscreenModal');
                    if (
                        renderToken !== fullscreenRenderToken ||
                        !modal ||
                        !modal.classList.contains('active')
                    ) {
                        return;
                    }

                    const currentMetrics = type === 'training'
                        ? trainingMetrics
                        : systemMetrics;
                    const currentMetric = currentMetrics.find(candidate =>
                        candidate.metricName === metric.metricName
                    );
                    if (!currentMetric) {
                        closeFullscreen();
                        return;
                    }

                    const ctx = document.getElementById('modalChart');
                    const datasets = createRunDatasets(currentMetric, true);
                    const sourceChart = ensureOverviewChart(currentMetric, type);
                    modalChart = createUnifiedChart(
                        ctx,
                        datasets,
                        currentMetric.metricName,
                        { isModal: true, enableZoom: true }
                    );
                    modalChart.$persistFullscreenState = true;
                    if (sourceChart) {
                        copyRunVisibility(sourceChart, modalChart, false);
                        modalChart.$isolatedRunKey = sourceChart.$isolatedRunKey || null;
                        modalChart.$preIsolationVisibility =
                            sourceChart.$preIsolationVisibility || null;
                        modalChart.$sourceChart = sourceChart;
                        modalChart.update('none');
                    }
                    if (focusedRunId) {
                        setFocusedRun(modalChart, focusedRunId);
                    }
                    updateChartAxes(modalChart, modalLogX, modalLogY);
                });
            }

            // Lazy chart initialization using IntersectionObserver
            // Only creates charts when they become visible (huge performance win for 50+ charts)
            const chartObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const canvas = entry.target;
                        const canvasId = canvas.id;

                        // Check if chart already exists
                        if (chartInstances[canvasId]) return;

                        // Defer chart creation to next frame to avoid blocking render
                        requestAnimationFrame(() => {
                            // Get metric data from dataset attributes
                            const type = canvas.dataset.chartType;
                            const index = parseInt(canvas.dataset.chartIndex);
                            const metrics = type === 'training' ? trainingMetrics : systemMetrics;
                            const metric = metrics[index];

                            if (!metric) return;

                            ensureOverviewChart(metric, type);

                            // Stop observing this chart
                            chartObserver.unobserve(canvas);
                        });
                    }
                });
            }, {
                rootMargin: '100px' // Start loading charts 100px before they enter viewport (conservative)
            });

            // Defer observer setup to next frame so UI renders immediately
            requestAnimationFrame(() => {
                // Observe all chart canvases for lazy loading
                document.querySelectorAll('canvas[id^="chart-"]').forEach(canvas => {
                    chartObserver.observe(canvas);
                });

                console.log('Lazy chart rendering initialized for ' + (trainingMetrics.length + systemMetrics.length) + ' charts');
            });

            const savedFullscreenMetric = persistedViewState.fullscreenMetric;
            if (
                ${this._isFullscreenOpen ? 'true' : 'false'} &&
                persistedViewState.fullscreenOpen === true &&
                savedFullscreenMetric &&
                typeof savedFullscreenMetric.metricName === 'string' &&
                (
                    savedFullscreenMetric.type === 'training' ||
                    savedFullscreenMetric.type === 'system'
                )
            ) {
                queueMicrotask(() => {
                    const metrics = savedFullscreenMetric.type === 'training'
                        ? trainingMetrics
                        : systemMetrics;
                    const metricIndex = metrics.findIndex(metric =>
                        metric.metricName === savedFullscreenMetric.metricName
                    );
                    if (metricIndex >= 0) {
                        openFullscreen(
                            metricIndex,
                            savedFullscreenMetric.type,
                            false
                        );
                    } else {
                        updatePersistedViewState({
                            fullscreenMetric: null,
                            fullscreenOpen: false
                        });
                    }
                });
            }

        `;
    }

    private _getPageStyles(): string {
        return `
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: var(--vscode-font-family);
                color: var(--vscode-foreground);
                background: var(--vscode-editor-background);
                height: 100vh;
                overflow: hidden;
            }
            .container {
                display: flex;
                height: 100vh;
                position: relative;
                overflow: hidden;
            }

            /* Sidebar */
            .sidebar {
                flex: 0 0 280px;
                background: var(--vscode-sideBar-background);
                border-right: 1px solid var(--vscode-panel-border);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                position: relative;
            }
            .sidebar.collapsed {
                flex: 0 0 0 !important;
                min-width: 0;
            }
            .resize-handle {
                position: absolute;
                right: 0;
                top: 0;
                bottom: 0;
                width: 4px;
                cursor: col-resize;
                background: transparent;
            }
            .resize-handle:hover {
                background: var(--vscode-focusBorder);
            }
            .sidebar-header {
                padding: 15px;
                border-bottom: 1px solid var(--vscode-panel-border);
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .sidebar-header h3 {
                font-size: 1em;
                font-weight: 600;
                margin: 0;
            }
            .controls-bar-wrapper {
                display: flex;
                align-items: center;
                gap: 8px;
                padding-left: 15px;
                position: sticky;
                top: 0;
                z-index: 100;
                background: var(--vscode-editor-background);
            }
            .controls-bar-wrapper .logo {
                width: 28px;
                height: 28px;
                flex-shrink: 0;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                line-height: 1;
            }
            .sidebar-controls {
                display: flex;
                gap: 5px;
            }
            .btn-icon {
                background: transparent;
                border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
                color: var(--vscode-foreground);
                padding: 4px 8px;
                cursor: pointer;
                border-radius: 3px;
                font-size: 0.9em;
            }
            .btn-icon:hover {
                background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
                color: var(--vscode-foreground);
            }
            .btn-icon:focus-visible {
                outline: 1px solid var(--vscode-focusBorder);
                outline-offset: 1px;
            }
            .btn-icon:disabled,
            .reload-runs-btn:disabled {
                cursor: wait;
                opacity: 0.65;
            }
            .reload-runs-btn,
            .rediscover-runs-btn {
                white-space: nowrap;
            }
            .sidebar-tabs {
                display: flex;
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            .sidebar-tab {
                flex: 1;
                padding: 8px;
                text-align: center;
                cursor: pointer;
                background: transparent;
                border: none;
                color: var(--vscode-tab-inactiveForeground);
                border-bottom: 2px solid transparent;
                font-size: 0.85em;
            }
            .sidebar-tab:hover {
                color: var(--vscode-tab-activeForeground);
            }
            .sidebar-tab.active {
                color: var(--vscode-tab-activeForeground);
                border-bottom-color: var(--vscode-tab-activeBorder);
            }
            .sidebar-content {
                flex: 1;
                overflow-y: auto;
                padding: 10px;
                display: none;
            }
            .sidebar-content.active {
                display: block;
            }
            #runsContent.active {
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            #runList {
                flex: 1 1 auto;
                min-height: 72px;
                overflow-y: auto;
            }
            .run-list-tools {
                position: sticky;
                top: -10px;
                z-index: 5;
                display: grid;
                grid-template-columns: minmax(72px, 1fr) minmax(92px, 0.9fr) auto;
                align-items: center;
                gap: 6px;
                margin: -2px -2px 8px;
                padding: 2px 2px 8px;
                background: var(--vscode-sideBar-background);
            }
            .run-list-tools input,
            .run-list-tools select {
                width: 100%;
                min-width: 0;
                padding: 5px 7px;
                border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
                border-radius: 3px;
                outline: none;
                color: var(--vscode-input-foreground);
                background: var(--vscode-input-background);
                font-family: var(--vscode-font-family);
                font-size: 0.8em;
            }
            .run-empty-filter {
                min-width: 0;
                padding: 5px 7px;
                border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
                border-radius: 3px;
                color: var(--vscode-foreground);
                background: transparent;
                font-family: var(--vscode-font-family);
                font-size: 0.8em;
                white-space: nowrap;
                cursor: pointer;
            }
            .run-empty-filter:hover:not(:disabled) {
                background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
            }
            .run-empty-filter.active {
                color: var(--vscode-button-foreground);
                background: var(--vscode-button-background);
                border-color: var(--vscode-button-background);
            }
            .run-empty-filter:disabled {
                cursor: default;
                opacity: 0.45;
            }
            .run-list-tools input:focus,
            .run-list-tools select:focus {
                border-color: var(--vscode-focusBorder);
                outline: 1px solid var(--vscode-focusBorder);
                outline-offset: -1px;
            }
            .run-filter-empty {
                display: none;
                padding: 18px 8px;
                text-align: center;
                color: var(--vscode-descriptionForeground);
                font-size: 0.8em;
            }
            .run-filter-empty.visible {
                display: block;
            }
            .comparison-groups-section {
                flex: 0 0 auto;
                max-height: 38%;
                margin: 10px -2px -2px;
                padding: 10px 2px 2px;
                border-top: 1px solid var(--vscode-panel-border);
                overflow-y: auto;
            }
            .comparison-groups-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                margin-bottom: 7px;
            }
            .comparison-groups-header h4 {
                margin: 0;
                font-size: 0.85em;
                font-weight: 600;
            }
            .comparison-groups-header span,
            .comparison-group-count,
            .comparison-groups-empty {
                color: var(--vscode-descriptionForeground);
                font-size: 0.7em;
            }
            .comparison-group-item {
                display: flex;
                align-items: center;
                gap: 7px;
                min-width: 0;
                padding: 6px 5px;
                border-radius: 4px;
            }
            .comparison-group-item:hover {
                background: var(--vscode-list-hoverBackground);
            }
            .comparison-group-toggle {
                width: 16px;
                height: 16px;
                flex: 0 0 16px;
                cursor: pointer;
                accent-color: var(--vscode-focusBorder, var(--vscode-button-background));
            }
            .comparison-group-toggle:disabled {
                cursor: default;
                opacity: 0.45;
            }
            .comparison-group-info {
                flex: 1;
                min-width: 0;
            }
            .comparison-group-name {
                overflow: hidden;
                font-size: 0.82em;
                font-weight: 500;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .comparison-group-action {
                width: 22px;
                height: 22px;
                flex: 0 0 22px;
                border: 0;
                border-radius: 3px;
                color: var(--vscode-foreground);
                background: transparent;
                cursor: pointer;
            }
            .comparison-group-action:hover {
                background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
            }
            .comparison-group-action.danger:hover {
                color: var(--vscode-errorForeground);
            }
            .comparison-groups-empty {
                padding: 6px 5px 8px;
            }
            .run-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px;
                margin-bottom: 4px;
                border-radius: 4px;
                cursor: pointer;
            }
            .run-item[hidden] {
                display: none;
            }
            .run-item:hover {
                background: var(--vscode-list-hoverBackground);
            }
            .run-item.focused-run {
                background: var(--vscode-list-activeSelectionBackground);
                color: var(--vscode-list-activeSelectionForeground);
            }
            .run-item.empty-run .run-info,
            .run-item.empty-run .run-color {
                opacity: 0.48;
                filter: grayscale(1);
            }
            .run-item.selection-loading .run-name::after {
                content: ' …';
                color: var(--vscode-descriptionForeground);
            }
            .run-item input[type="checkbox"] {
                width: 16px;
                height: 16px;
                cursor: pointer;
                accent-color: var(--vscode-focusBorder, var(--vscode-button-background));
            }
            .run-color {
                width: 12px;
                height: 12px;
                border-radius: 2px;
            }
            .run-info {
                flex: 1;
                min-width: 0;
            }
            .run-name-row {
                display: flex;
                align-items: center;
                gap: 5px;
                min-width: 0;
            }
            .run-activity {
                width: 9px;
                flex: 0 0 9px;
                visibility: hidden;
                color: var(--vscode-testing-iconPassed, #73c991);
                font-size: 9px;
                line-height: 1;
            }
            .run-item.running-run .run-activity {
                visibility: visible;
                animation: run-activity-pulse 1.8s ease-in-out infinite;
            }
            @keyframes run-activity-pulse {
                0%, 100% { opacity: 0.45; }
                50% { opacity: 1; }
            }
            @media (prefers-reduced-motion: reduce) {
                .run-item.running-run .run-activity {
                    animation: none;
                    opacity: 0.85;
                }
            }
            .run-name {
                flex: 1;
                min-width: 0;
                font-size: 0.85em;
                font-weight: 500;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                cursor: pointer;
            }
            .run-name:hover {
                text-decoration: underline;
            }
            .run-meta {
                font-size: 0.7em;
                color: var(--vscode-descriptionForeground);
                display: flex;
                align-items: center;
                gap: 4px;
                min-width: 0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .run-created {
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .sync-status {
                position: relative;
                display: inline-flex;
                width: 14px;
                flex: 0 0 14px;
                justify-content: center;
                color: var(--vscode-descriptionForeground);
            }
            .sync-status.synced {
                color: var(--vscode-testing-iconPassed, #73c991);
            }
            .sync-status.unsynced::after {
                content: '';
                position: absolute;
                left: 1px;
                top: 6px;
                width: 13px;
                height: 1px;
                background: var(--vscode-testing-iconFailed, #f14c4c);
                transform: rotate(-42deg);
                transform-origin: center;
            }
            .run-context-menu {
                position: fixed;
                z-index: 2000;
                display: none;
                min-width: 210px;
                padding: 4px;
                border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
                border-radius: 4px;
                background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
            }
            .run-context-menu.visible {
                display: block;
            }
            .run-context-menu button {
                display: block;
                width: 100%;
                padding: 6px 10px;
                border: 0;
                border-radius: 2px;
                color: var(--vscode-menu-foreground, var(--vscode-foreground));
                background: transparent;
                text-align: left;
                font: inherit;
                cursor: pointer;
            }
            .run-context-menu button:hover {
                color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
                background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
            }
            .metadata-section {
                margin-bottom: 8px;
                border-radius: 4px;
                background: var(--vscode-editor-inactiveSelectionBackground);
            }
            .metadata-header {
                padding: 10px;
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                font-size: 0.85em;
            }
            .metadata-header:hover {
                background: var(--vscode-list-hoverBackground);
            }
            .metadata-run-name {
                font-weight: 600;
            }
            .metadata-toggle {
                transition: transform 0.2s;
            }
            .metadata-section.collapsed .metadata-toggle {
                transform: rotate(-90deg);
            }
            .metadata-content {
                max-height: 300px;
                overflow-y: auto;
                border-top: 1px solid var(--vscode-panel-border);
            }
            .metadata-section.collapsed .metadata-content {
                display: none;
            }
            .config-grid {
                padding: 10px;
            }
            .config-item {
                padding: 4px 0;
                font-size: 0.8em;
            }
            .config-key {
                color: var(--vscode-symbolIcon-variableForeground);
                font-weight: 600;
            }
            .config-value {
                color: var(--vscode-foreground);
                margin-left: 8px;
            }
            .config-value pre {
                background: var(--vscode-textCodeBlock-background);
                padding: 8px;
                border-radius: 3px;
                border: 1px solid var(--vscode-panel-border);
                overflow-x: auto;
            }
            .no-config, .no-data {
                padding: 15px;
                text-align: center;
                color: var(--vscode-descriptionForeground);
                font-size: 0.8em;
            }
            .config-compare-view {
                min-width: 0;
            }
            .config-compare-title-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: 16px;
                margin-bottom: 14px;
            }
            .config-compare-title-row h2 {
                margin: 0 0 4px;
                font-size: 1.1em;
            }
            .config-compare-summary {
                color: var(--vscode-descriptionForeground);
                font-size: 0.85em;
            }
            .config-compare-tools {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                flex-wrap: nowrap;
                gap: 8px;
                max-width: 100%;
                overflow-x: auto;
            }
            .config-filter-input {
                flex: 1 1 280px;
                min-width: 160px;
                padding: 6px 8px;
                border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
                border-radius: 3px;
                outline: none;
                color: var(--vscode-input-foreground);
                background: var(--vscode-input-background);
                font-family: var(--vscode-font-family);
                font-size: 0.85em;
            }
            .config-filter-input:focus {
                border-color: var(--vscode-focusBorder);
                outline: 1px solid var(--vscode-focusBorder);
                outline-offset: -1px;
            }
            .config-sort-select {
                flex: 0 0 auto;
                padding: 6px 8px;
                border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
                border-radius: 3px;
                outline: none;
                color: var(--vscode-dropdown-foreground);
                background: var(--vscode-dropdown-background);
                font-family: var(--vscode-font-family);
                font-size: 0.85em;
            }
            .config-sort-select:focus {
                border-color: var(--vscode-focusBorder);
                outline: 1px solid var(--vscode-focusBorder);
                outline-offset: -1px;
            }
            .config-compare-table-wrapper {
                max-width: 100%;
                overflow: auto;
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
            }
            .config-compare-table {
                width: max-content;
                min-width: 100%;
                border-collapse: separate;
                border-spacing: 0;
                font-size: 0.85em;
            }
            .config-compare-table th,
            .config-compare-table td {
                padding: 6px 9px;
                text-align: left;
                vertical-align: top;
                white-space: nowrap;
                border-right: 1px solid var(--vscode-panel-border);
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            .config-compare-table [hidden] {
                display: none;
            }
            .config-compare-table thead th {
                position: sticky;
                top: 0;
                z-index: 2;
                background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background));
            }
            .config-compare-table .config-run-column {
                position: sticky;
                left: 0;
                z-index: 3;
                min-width: 160px;
                background: var(--vscode-sideBar-background);
                font-weight: 600;
            }
            .config-parameter-groups th {
                padding-top: 7px;
                padding-bottom: 7px;
                color: var(--vscode-descriptionForeground);
                font-size: 0.78em;
                letter-spacing: 0.04em;
                text-transform: uppercase;
            }
            .config-different-group {
                background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background)) !important;
            }
            .config-common-group,
            .config-common-column {
                background: var(--vscode-editor-inactiveSelectionBackground) !important;
            }
            .config-common-start {
                border-left: 4px solid var(--vscode-focusBorder, #007acc) !important;
            }
            .config-compare-table tr:last-child > * {
                border-bottom: none;
            }
            .config-compare-table tr > *:last-child {
                border-right: none;
            }
            .config-compare-run-name,
            .config-compare-run-id {
                display: block;
            }
            .config-compare-run-heading {
                display: flex;
                align-items: center;
                gap: 9px;
            }
            .config-compare-run-color {
                width: 12px;
                height: 12px;
                flex: 0 0 12px;
                border-radius: 2px;
            }
            .config-compare-run-id {
                margin-top: 3px;
                color: var(--vscode-descriptionForeground);
                font-family: var(--vscode-editor-font-family);
                font-size: 0.8em;
                font-weight: 400;
            }
            .config-missing {
                color: var(--vscode-descriptionForeground);
                font-style: italic;
            }
            .config-compare-value {
                font-family: var(--vscode-editor-font-family);
            }
            .config-compare-empty {
                padding: 32px;
                text-align: center;
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
                color: var(--vscode-descriptionForeground);
            }

            /* Collapse buttons */
            .collapse-btn, .expand-btn {
                position: fixed;
                top: 50%;
                transform: translateY(-50%);
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 8px 6px;
                cursor: pointer;
                z-index: 100;
                border-radius: 3px;
                font-size: 12px;
            }
            .collapse-btn {
                left: 270px;
            }
            .expand-btn {
                left: 10px;
                display: none;
            }

            /* Main content */
            .main-content {
                flex: 1;
                overflow-y: auto;
                padding: 20px;
            }
            .metric-group {
                margin-bottom: 30px;
            }
            .metric-group h3 {
                font-size: 1.1em;
                font-weight: 600;
                margin-bottom: 15px;
                color: var(--vscode-foreground);
            }
            .tabs {
                display: flex;
                gap: 10px;
                margin-bottom: 20px;
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            .tab {
                background: transparent;
                border: none;
                border-bottom: 2px solid transparent;
                color: var(--vscode-tab-inactiveForeground);
                padding: 10px 20px;
                cursor: pointer;
                font-size: 0.9em;
            }
            .tab:hover {
                color: var(--vscode-tab-activeForeground);
            }
            .tab.active {
                color: var(--vscode-tab-activeForeground);
                border-bottom-color: var(--vscode-tab-activeBorder);
            }
            .tab-content {
                display: none;
            }
            .tab-content.active {
                display: block;
            }
            .chart-resize-handle {
                position: relative;
                height: 16px;
                margin: 6px -8px -10px;
                border-top: 1px solid var(--vscode-panel-border, #555);
                cursor: row-resize;
                touch-action: none;
                transition: border-color 0.15s, background-color 0.15s;
            }
            .chart-resize-handle::after {
                content: '';
                position: absolute;
                top: 4px;
                left: 50%;
                width: 48px;
                height: 4px;
                border-radius: 2px;
                background: var(--vscode-descriptionForeground, #999);
                opacity: 0.85;
                transform: translateX(-50%);
                transition: background-color 0.15s, opacity 0.15s;
            }
            .chart-resize-handle:hover,
            .chart-resize-handle:focus-visible,
            .chart-resize-handle.active {
                border-top-color: var(--vscode-focusBorder, #007acc);
                background: var(--vscode-list-hoverBackground);
                outline: none;
            }
            .chart-resize-handle:hover::after,
            .chart-resize-handle:focus-visible::after,
            .chart-resize-handle.active::after {
                background: var(--vscode-focusBorder, #007acc);
                opacity: 1;
            }
            body.chart-resizing {
                cursor: row-resize;
                user-select: none;
            }
        `;
    }

    private _escapeHtml(text: string): string {
        return text.replace(/[&<>"']/g, (char) => {
            const entities: { [key: string]: string } = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            };
            return entities[char] || char;
        });
    }

    private _getRunSortOptionsHtml(labelPrefix: string = ''): string {
        const options: Array<{ value: RunSortMode; label: string }> = [
            { value: 'created-desc', label: 'Created newest' },
            { value: 'created-asc', label: 'Created oldest' },
            { value: 'name-asc', label: 'Name A–Z' },
            { value: 'name-desc', label: 'Name Z–A' },
            { value: 'updated-desc', label: 'Updated newest' },
            { value: 'updated-asc', label: 'Updated oldest' }
        ];

        return options.map(option => `
            <option value="${option.value}" ${option.value === this._defaultRunSort ? 'selected' : ''}>
                ${labelPrefix}${option.label}
            </option>
        `).join('');
    }

    private _formatTimestamp(timestamp: number): string {
        if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return 'Unknown';
        }

        return new Date(timestamp).toLocaleString();
    }

    private _formatShortTimestamp(timestamp: number): string {
        if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return 'Unknown';
        }

        return new Date(timestamp).toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    private _formatConfigValue(value: any): string {
        if (value === null || value === undefined) {
            return '<span style="color: var(--vscode-descriptionForeground);">null</span>';
        }
        
        if (typeof value === 'string') {
            return this._escapeHtml(value);
        }
        
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        
        if (typeof value === 'object') {
            // Format objects and arrays with indentation
            const json = JSON.stringify(value, null, 2);
            return `<pre style="margin: 4px 0; font-family: var(--vscode-editor-font-family); font-size: 0.9em; white-space: pre-wrap; word-break: break-all;">${this._escapeHtml(json)}</pre>`;
        }
        
        return this._escapeHtml(String(value));
    }

    private _formatConfigComparisonValue(value: any): string {
        if (value === null || value === undefined) {
            return '<span class="config-compare-value">null</span>';
        }

        const compactValue = typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
        return `<span class="config-compare-value">${this._escapeHtml(compactValue)}</span>`;
    }

    private async _handleGenerateAIContext(action: string) {
        // Get selected runs
        const selectedRuns = this._manager.getRuns()
            .filter(r => this._manager.isRunSelected(r.runId))
            .map(run => this._withDisplayRunName(run));

        if (selectedRuns.length === 0) {
            vscode.window.showWarningMessage('Please select at least one run to generate AI context.');
            return;
        }

        // Generate the AI context
        try {
            const context = generateAIContext(
                selectedRuns,
                this._manager.getState().parsedData,
                this._folderPath
            );
            const tokens = calculateTokenEstimate(context);

            if (action === 'copy') {
                // Copy to clipboard
                await vscode.env.clipboard.writeText(context);

                vscode.window.showInformationMessage(
                    `Context copied to clipboard (${tokens} tokens)`
                );
            } else if (action === 'save') {
                // Save to file
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(this._folderPath, 'wandb-context.md')),
                    filters: {
                        'Markdown': ['md'],
                        'MCD': ['mdc'],
                        'All Files': ['*']
                    }
                });

                if (uri) {
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(context, 'utf8'));

                    vscode.window.showInformationMessage(
                        `Context saved to ${path.basename(uri.fsPath)} (${tokens} tokens)`
                    );
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to generate AI context: ${error instanceof Error ? error.message : String(error)}`
            );
            console.error('Error generating AI context:', error);
        }
    }

    private async _handleSaveChartImage(imageBase64: string, chartCount: number) {
        try {
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(this._folderPath, 'wandb-charts.png')),
                filters: {
                    'PNG Image': ['png']
                }
            });

            if (uri) {
                const buffer = Buffer.from(imageBase64, 'base64');
                await vscode.workspace.fs.writeFile(uri, buffer);

                vscode.window.showInformationMessage(
                    `Chart image saved to ${path.basename(uri.fsPath)} (${chartCount} charts)`
                );
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to save chart image: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private async _handleCopyChartImageFallback(imageBase64: string) {
        try {
            const os = require('os');
            const tmpPath = path.join(os.tmpdir(), `wandb-charts-${Date.now()}.png`);
            const buffer = Buffer.from(imageBase64, 'base64');
            fs.writeFileSync(tmpPath, buffer);

            const selection = await vscode.window.showInformationMessage(
                `Chart image saved to temporary file.`,
                'Open File'
            );
            if (selection === 'Open File') {
                await vscode.env.openExternal(vscode.Uri.file(tmpPath));
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                'Failed to save chart image. Please use "Save as PNG" instead.'
            );
        }
    }

    private _getLoadingHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loading...</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
        }
        .loading-container {
            text-align: center;
        }
        .spinner {
            width: 48px;
            height: 48px;
            border: 4px solid var(--vscode-progressBar-background, #333);
            border-top-color: var(--vscode-progressBar-background, #007acc);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .loading-text {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="loading-container">
        <div class="spinner"></div>
        <div class="loading-text">Loading W&B runs...</div>
    </div>
</body>
</html>`;
    }

    public dispose() {
        this._disposed = true;
        MultiRunViewerPanel.panels.delete(this);
        if (this._initialUpdateTimer) {
            clearTimeout(this._initialUpdateTimer);
            this._initialUpdateTimer = null;
        }
        if (this._selectionRefreshTimer) {
            clearTimeout(this._selectionRefreshTimer);
            this._selectionRefreshTimer = null;
        }
        this._selectionRefreshPending = false;
        this._panel.dispose();
        for (const watcher of this._folderWatchers.values()) {
            watcher.dispose();
        }
        this._folderWatchers.clear();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
