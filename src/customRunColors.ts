import type * as vscode from 'vscode';

const CUSTOM_RUN_COLORS_STORAGE_KEY = 'wandbViewer.customRunColors';
const CUSTOM_WANDB_GROUP_COLORS_STORAGE_KEY = 'wandbViewer.customWandbGroupColors';
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function normalizeCustomRunColor(value: unknown): string | undefined {
    if (typeof value !== 'string' || !HEX_COLOR_PATTERN.test(value)) {
        return undefined;
    }
    return value.toLowerCase();
}

export function getCustomRunColors(storage: vscode.Memento): Record<string, string> {
    const stored = storage.get<unknown>(CUSTOM_RUN_COLORS_STORAGE_KEY);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(stored).flatMap(([runId, color]) => {
            const normalizedColor = normalizeCustomRunColor(color);
            return normalizedColor ? [[runId, normalizedColor]] : [];
        })
    );
}

export async function setCustomRunColor(
    storage: vscode.Memento,
    runId: string,
    color: string | undefined
): Promise<Record<string, string>> {
    const existingColors = getCustomRunColors(storage);
    const normalizedColor = normalizeCustomRunColor(color);
    const updatedColors = {
        ...existingColors
    };

    if (normalizedColor) {
        updatedColors[runId] = normalizedColor;
    } else {
        delete updatedColors[runId];
    }

    await storage.update(
        CUSTOM_RUN_COLORS_STORAGE_KEY,
        Object.keys(updatedColors).length > 0 ? updatedColors : undefined
    );
    return updatedColors;
}

export function getCustomWandbGroupColors(
    storage: vscode.Memento
): Record<string, string> {
    const stored = storage.get<unknown>(CUSTOM_WANDB_GROUP_COLORS_STORAGE_KEY);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(stored).flatMap(([groupName, color]) => {
            const normalizedColor = normalizeCustomRunColor(color);
            return normalizedColor ? [[groupName, normalizedColor]] : [];
        })
    );
}

export async function setCustomWandbGroupColor(
    storage: vscode.Memento,
    groupName: string,
    color: string | undefined
): Promise<Record<string, string>> {
    const existingColors = getCustomWandbGroupColors(storage);
    const normalizedColor = normalizeCustomRunColor(color);
    const updatedColors = {
        ...existingColors
    };

    if (normalizedColor) {
        updatedColors[groupName] = normalizedColor;
    } else {
        delete updatedColors[groupName];
    }

    await storage.update(
        CUSTOM_WANDB_GROUP_COLORS_STORAGE_KEY,
        Object.keys(updatedColors).length > 0 ? updatedColors : undefined
    );
    return updatedColors;
}
