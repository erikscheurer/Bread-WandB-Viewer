import type * as vscode from 'vscode';

const CUSTOM_RUN_NAMES_STORAGE_KEY = 'wandbViewer.customRunNames';
const MAX_CUSTOM_RUN_NAME_LENGTH = 200;

export function getCustomRunNames(storage: vscode.Memento): Record<string, string> {
    const stored = storage.get<unknown>(CUSTOM_RUN_NAMES_STORAGE_KEY);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(stored)
            .filter((entry): entry is [string, string] =>
                typeof entry[1] === 'string' &&
                entry[1].trim().length > 0 &&
                entry[1].trim().length <= MAX_CUSTOM_RUN_NAME_LENGTH
            )
            .map(([runId, customName]) => [runId, customName.trim()])
    );
}

export function getCustomRunName(
    storage: vscode.Memento,
    runId: string
): string | undefined {
    return getCustomRunNames(storage)[runId];
}

export async function setCustomRunName(
    storage: vscode.Memento,
    runId: string,
    customName: string
): Promise<Record<string, string>> {
    const existingNames = getCustomRunNames(storage);
    const entries = Object.entries(existingNames)
        .filter(([existingRunId]) => existingRunId !== runId);
    const trimmedName = customName.trim();
    if (trimmedName) {
        entries.push([runId, trimmedName.slice(0, MAX_CUSTOM_RUN_NAME_LENGTH)]);
    }

    const updatedNames = Object.fromEntries(entries);
    await storage.update(
        CUSTOM_RUN_NAMES_STORAGE_KEY,
        entries.length > 0 ? updatedNames : undefined
    );
    return updatedNames;
}

export function validateCustomRunName(value: string): string | undefined {
    const trimmedName = value.trim();
    if (trimmedName.length > MAX_CUSTOM_RUN_NAME_LENGTH) {
        return `Custom names must be at most ${MAX_CUSTOM_RUN_NAME_LENGTH} characters.`;
    }
    if (/\p{Cc}/u.test(trimmedName)) {
        return 'Custom names cannot contain control characters.';
    }
    return undefined;
}
