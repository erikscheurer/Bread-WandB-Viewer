import * as fs from 'fs';
import * as path from 'path';

export const RUN_COMPARISON_GROUPS_FILE = '.wandb-viewer-groups.json';

const GROUP_FILE_VERSION = 1;
const MAX_GROUP_FILE_BYTES = 256 * 1024;
const MAX_GROUP_COUNT = 100;
const MAX_GROUP_NAME_LENGTH = 100;
const MAX_GROUP_RUN_COUNT = 10_000;
const MAX_RUN_ID_LENGTH = 512;

export interface RunComparisonGroup {
    id: string;
    name: string;
    runIds: string[];
}

interface RunComparisonGroupFile {
    version: number;
    groups: RunComparisonGroup[];
}

function isSafeIdentifier(value: unknown): value is string {
    return typeof value === 'string' &&
        value.length > 0 &&
        value.length <= MAX_RUN_ID_LENGTH &&
        !/\p{Cc}/u.test(value);
}

export function validateRunComparisonGroupName(value: string): string | undefined {
    const name = value.trim();
    if (!name) {
        return 'Comparison group names cannot be empty.';
    }
    if (name.length > MAX_GROUP_NAME_LENGTH) {
        return `Comparison group names must be at most ${MAX_GROUP_NAME_LENGTH} characters.`;
    }
    if (/\p{Cc}/u.test(name)) {
        return 'Comparison group names cannot contain control characters.';
    }
    return undefined;
}

export function normalizeRunComparisonGroups(value: unknown): RunComparisonGroup[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return [];
    }

    const candidate = value as Partial<RunComparisonGroupFile>;
    if (candidate.version !== GROUP_FILE_VERSION || !Array.isArray(candidate.groups)) {
        return [];
    }

    const seenIds = new Set<string>();
    const groups: RunComparisonGroup[] = [];
    for (const rawGroup of candidate.groups.slice(0, MAX_GROUP_COUNT)) {
        if (!rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup)) {
            continue;
        }

        const group = rawGroup as Partial<RunComparisonGroup>;
        const name = typeof group.name === 'string' ? group.name.trim() : '';
        if (
            !isSafeIdentifier(group.id) ||
            seenIds.has(group.id) ||
            validateRunComparisonGroupName(name) !== undefined ||
            !Array.isArray(group.runIds)
        ) {
            continue;
        }

        const runIds = Array.from(new Set(
            group.runIds
                .slice(0, MAX_GROUP_RUN_COUNT)
                .filter(isSafeIdentifier)
        ));
        seenIds.add(group.id);
        groups.push({ id: group.id, name, runIds });
    }
    return groups;
}

export async function loadRunComparisonGroups(
    folderPath: string
): Promise<RunComparisonGroup[]> {
    const filePath = path.join(folderPath, RUN_COMPARISON_GROUPS_FILE);
    try {
        const stats = await fs.promises.stat(filePath);
        if (!stats.isFile() || stats.size > MAX_GROUP_FILE_BYTES) {
            throw new Error('invalid-comparison-group-file');
        }
        const contents = await fs.promises.readFile(filePath, 'utf8');
        return normalizeRunComparisonGroups(JSON.parse(contents));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw new Error('could-not-read-comparison-groups');
    }
}

export async function saveRunComparisonGroups(
    folderPath: string,
    groups: RunComparisonGroup[]
): Promise<void> {
    const normalizedGroups = normalizeRunComparisonGroups({
        version: GROUP_FILE_VERSION,
        groups
    });
    if (normalizedGroups.length !== groups.length) {
        throw new Error('invalid-comparison-groups');
    }

    const file: RunComparisonGroupFile = {
        version: GROUP_FILE_VERSION,
        groups: normalizedGroups
    };
    await fs.promises.writeFile(
        path.join(folderPath, RUN_COMPARISON_GROUPS_FILE),
        `${JSON.stringify(file, null, 2)}\n`,
        'utf8'
    );
}
