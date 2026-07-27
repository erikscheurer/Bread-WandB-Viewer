/**
 * Config comparison and diff generation for AI Context
 */

import { WandbConfig } from '../wandbParser';
import { ConfigComparison } from './types';
import { formatNumber } from './formatNumber';

/**
 * Compare configurations across multiple runs
 * Categorizes parameters into common (same across all runs) and differences
 */
export function compareConfigs(runConfigs: Map<string, WandbConfig>): ConfigComparison {
    const allKeys = new Set<string>();
    const keyValues = new Map<string, Map<string, any>>();
    const runIds = Array.from(runConfigs.keys());

    // Collect all keys and values per run
    for (const [runId, config] of runConfigs) {
        for (const [key, value] of Object.entries(config)) {
            allKeys.add(key);
            if (!keyValues.has(key)) {
                keyValues.set(key, new Map());
            }
            keyValues.get(key)!.set(runId, value);
        }
    }

    const common: Record<string, any> = {};
    const differences: Record<string, Record<string, any>> = {};

    // Categorize each parameter
    for (const key of allKeys) {
        const values = keyValues.get(key)!;
        const uniqueValues = new Set(
            Array.from(values.values()).map(v => JSON.stringify(v))
        );

        if (values.size === runIds.length && uniqueValues.size === 1) {
            // All runs have the same value
            common[key] = Array.from(values.values())[0];
        } else {
            // Values differ across runs or the parameter is missing from one.
            differences[key] = Object.fromEntries(values);
        }
    }

    return {
        common,
        differences,
        metadata: {
            totalParams: allKeys.size,
            commonCount: Object.keys(common).length,
            differingCount: Object.keys(differences).length
        }
    };
}

/**
 * Format common parameters as markdown list
 */
export function formatCommonParams(common: Record<string, any>, maxDisplay: number = 20): string {
    const entries = Object.entries(common);

    if (entries.length === 0) {
        return '*No common parameters*\n';
    }

    let result = '';
    const displayCount = Math.min(entries.length, maxDisplay);

    for (let i = 0; i < displayCount; i++) {
        const [key, value] = entries[i];
        const valueStr = formatValue(value);
        result += `- ${key}: ${valueStr}\n`;
    }

    if (entries.length > maxDisplay) {
        result += `- *...and ${entries.length - maxDisplay} more*\n`;
    }

    return result;
}

/**
 * Format parameter differences as markdown table
 */
export function formatDifferences(
    differences: Record<string, Record<string, any>>,
    runNames: Map<string, string>
): string {
    const entries = Object.entries(differences);

    if (entries.length === 0) {
        return '*No differences found*\n';
    }

    // Get sorted run IDs for consistent column order
    const runIds = Array.from(runNames.keys()).sort();
    const runHeaders = runIds.map(id => runNames.get(id) || id.substring(0, 8));

    // Build table header
    let table = `| Parameter | ${runHeaders.join(' | ')} |\n`;
    table += `|${'-'.repeat(11)}|${runHeaders.map(() => '-'.repeat(10)).join('|')}|\n`;

    // Build table rows
    for (const [key, runValues] of entries) {
        const values = runIds.map(runId => {
            const value = runValues[runId];
            return value !== undefined ? formatValue(value) : '-';
        });
        table += `| ${key} | ${values.join(' | ')} |\n`;
    }

    return table;
}

/**
 * Format a config value for display
 */
function formatValue(value: any): string {
    if (value === null || value === undefined) {
        return 'null';
    }
    if (typeof value === 'string') {
        return value.length > 100 ? value.substring(0, 97) + '...' : value;
    }
    if (typeof value === 'number') {
        return formatNumber(value);
    }
    if (typeof value === 'boolean') {
        return value.toString();
    }
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        if (value.length <= 3) {
            return `[${value.map(v => formatValue(v)).join(', ')}]`;
        }
        return `[${value.slice(0, 3).map(v => formatValue(v)).join(', ')}, ...]`;
    }
    if (typeof value === 'object') {
        const str = JSON.stringify(value);
        return str.length > 100 ? str.substring(0, 97) + '...' : str;
    }
    return String(value);
}
