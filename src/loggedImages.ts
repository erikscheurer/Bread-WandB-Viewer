import * as fs from 'fs';
import * as path from 'path';

export interface LoggedImage {
    path: string;
    caption?: string;
}

export interface LoggedImageFrame {
    step: number;
    timestamp?: number;
    images: LoggedImage[];
}

export type LoggedImageHistory = Record<string, LoggedImageFrame[]>;

interface HistoryItem {
    key?: string;
    nested_key?: string[];
    value_json?: string;
}

/** W&B history may contain whole media objects or their flattened fields. */
export function readHistoryImages(items: HistoryItem[], recordStep: number): {
    frames: Map<string, LoggedImageFrame>;
    mediaKeys: Set<string>;
    values: Map<string, unknown>;
} {
    const values = new Map<string, unknown>();
    for (const item of items) {
        const key = item.key || item.nested_key?.join('/');
        if (!key || typeof item.value_json !== 'string') continue;
        try { values.set(key, JSON.parse(item.value_json)); } catch { }
    }
    const loggedStep = values.get('_step');
    const step = typeof loggedStep === 'number' && Number.isFinite(loggedStep)
        ? loggedStep : Number.isFinite(recordStep) ? recordStep : 0;
    const loggedTimestamp = values.get('_timestamp');
    const timestamp = typeof loggedTimestamp === 'number' && Number.isFinite(loggedTimestamp)
        ? loggedTimestamp : undefined;
    const frames = new Map<string, LoggedImageFrame>();
    const mediaKeys = new Set<string>();
    const addMedia = (key: string, value: any, depth = 0): void => {
        if (!value || typeof value !== 'object' || depth > 10 || key.length > 1024) return;
        let images: LoggedImage[] | undefined;
        if (value._type === 'image-file') {
            mediaKeys.add(key);
            images = typeof value.path === 'string' && value.path.length <= 4096
                ? [{ path: value.path, caption: typeof value.caption === 'string' ? value.caption.slice(0, 4000) : undefined }]
                : [{ path: '' }];
        } else if (value._type === 'images/separated') {
            mediaKeys.add(key);
            images = Array.isArray(value.filenames) ? value.filenames.slice(0, 108).map((filename: unknown, index: number) => ({
                path: typeof filename === 'string' && filename.length <= 4096 ? filename : '',
                caption: typeof value.captions?.[index] === 'string' ? value.captions[index].slice(0, 4000) : undefined
            })) : [];
        } else if (Array.isArray(value)) {
            // Some producers serialize a list of image-file objects directly.
            if (value.length > 0 && value.every(item => item?._type === 'image-file')) {
                mediaKeys.add(key);
                images = value.slice(0, 108).map(item => ({
                    path: typeof item.path === 'string' && item.path.length <= 4096 ? item.path : '',
                    caption: typeof item.caption === 'string' ? item.caption.slice(0, 4000) : undefined
                }));
            }
        } else if (!value._type) {
            for (const [childKey, childValue] of Object.entries(value)) {
                addMedia(key + '/' + childKey, childValue, depth + 1);
            }
        }
        if (images?.length) frames.set(key, { step, timestamp, images });
    };
    for (const [key, value] of values) addMedia(key, value);
    for (const [key, value] of values) {
        if (!key.endsWith('/_type') || (value !== 'image-file' && value !== 'images/separated')) continue;
        const prefix = key.slice(0, -6);
        const media: Record<string, unknown> = { _type: value };
        for (const field of ['path', 'caption', 'filenames', 'captions']) {
            media[field] = values.get(prefix + '/' + field);
        }
        addMedia(prefix, media);
    }
    return { frames, mediaKeys, values };
}

function isWithin(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

const IMAGE_METADATA_FIELDS = new Set([
    '_type', 'path', 'sha256', 'size', 'width', 'height', 'format',
    'grouping', 'caption', 'count', 'filenames', 'captions',
    'artifact_path', 'latest_artifact_path', 'log_mode'
]);
const IMAGE_METADATA_BRANCHES = new Set([
    'boxes', 'masks', 'classes', 'all_boxes', 'all_masks',
    'box_class_maps', 'mask_class_maps'
]);

export function isImageMetadataField(key: string, mediaKeys: Set<string>): boolean {
    let parentKey = key;
    while (parentKey.includes('/')) {
        parentKey = parentKey.slice(0, parentKey.lastIndexOf('/'));
        if (!mediaKeys.has(parentKey)) continue;
        const field = key.slice(parentKey.length + 1);
        // An image key may also be a prefix for independent scalar metrics.
        // Exclude only actual media properties and annotation branches.
        if (IMAGE_METADATA_FIELDS.has(field) || IMAGE_METADATA_BRANCHES.has(field.split('/')[0])) return true;
    }
    return false;
}

/** Resolve raster media only; reject URLs, traversal, and symlinks outside the run. */
export async function resolveLoggedImagePath(runDir: string, loggedPath: string): Promise<string | undefined> {
    const logicalPath = loggedPath.replace(/^files\//, '');
    if (!logicalPath.startsWith('media/images/') || logicalPath.length > 4096 ||
        logicalPath.includes('\\') || logicalPath.includes('\0') || logicalPath.includes(':') ||
        logicalPath.split('/').some(part => part === '..' || part === '.') ||
        !/\.(png|jpe?g|gif|webp|bmp)$/i.test(logicalPath)) return undefined;
    try {
        const realRunDir = await fs.promises.realpath(runDir);
        // Validate real targets, but preserve the run alias in the returned URI.
        // Webview resource roots use the opened path, including latest-run links.
        for (const base of [path.resolve(runDir, 'files'), path.resolve(runDir)]) {
            try {
                const mediaRoot = await fs.promises.realpath(path.join(base, 'media', 'images'));
                if (!isWithin(realRunDir, mediaRoot)) continue;
                const imagePath = path.join(base, logicalPath);
                const candidate = await fs.promises.realpath(imagePath);
                if (!isWithin(mediaRoot, candidate)) continue;
                if ((await fs.promises.stat(candidate)).isFile()) return imagePath;
            } catch { }
        }
    } catch { }
    return undefined;
}
