import * as path from 'path';

const MAX_RESTORED_FOLDERS = 20;
const MAX_RESTORED_RUN_IDS = 10_000;

export interface MultiRunPanelRestorationState {
    folderPaths: string[];
    selectedRunIds: string[];
}

export function normalizeMultiRunPanelRestorationState(
    value: unknown
): MultiRunPanelRestorationState | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }

    const candidate = value as Partial<MultiRunPanelRestorationState>;
    if (!Array.isArray(candidate.folderPaths) || candidate.folderPaths.length === 0) {
        return undefined;
    }

    const folderPaths = Array.from(new Set(
        candidate.folderPaths
            .slice(0, MAX_RESTORED_FOLDERS)
            .filter((folderPath): folderPath is string =>
                typeof folderPath === 'string' &&
                folderPath.length > 0 &&
                folderPath.length <= 4096 &&
                path.isAbsolute(folderPath) &&
                !/\p{Cc}/u.test(folderPath)
            )
            .map(folderPath => path.resolve(folderPath))
    ));
    if (folderPaths.length === 0) {
        return undefined;
    }

    const selectedRunIds = Array.isArray(candidate.selectedRunIds)
        ? Array.from(new Set(
            candidate.selectedRunIds
                .slice(0, MAX_RESTORED_RUN_IDS)
                .filter((runId): runId is string =>
                    typeof runId === 'string' &&
                    runId.length > 0 &&
                    runId.length <= 512 &&
                    !/\p{Cc}/u.test(runId)
                )
        ))
        : [];

    return { folderPaths, selectedRunIds };
}
