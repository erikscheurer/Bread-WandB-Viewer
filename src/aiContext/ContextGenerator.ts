/**
 * Main AI Context generator - orchestrates the creation of markdown-formatted
 * W&B run context for AI coding assistants (Cursor, Claude Code, Copilot)
 */

import { RunScanResult } from '../MultiRunScanner';
import { WandbRunData, WandbMetrics, MetricPoint } from '../wandbParser';
import { compareConfigs, formatCommonParams, formatDifferences } from './ConfigDiffer';
import { summarizeMetric, formatMetricSummary, generateCSV, groupMetricsByPrefix } from './MetricSummarizer';
import { formatNumber } from './formatNumber';
import * as path from 'path';
import { flattenConfig } from '../configUtils';

/**
 * Generate AI-optimized context from selected W&B runs
 *
 * @param runs - Array of selected run metadata
 * @param parsedData - Map of runId to parsed W&B data
 * @param folderPath - Path to the folder containing runs
 * @returns Markdown-formatted context string
 */
export function generateAIContext(
    runs: RunScanResult[],
    parsedData: Map<string, WandbRunData>,
    folderPath: string
): string {
    if (runs.length === 0) {
        return '# W&B Training Runs Context\n\nNo runs selected.';
    }

    const timestamp = new Date().toISOString();
    let markdown = '';

    // Header
    markdown += '# W&B Training Runs Context\n\n';
    markdown += `Generated: ${timestamp}\n`;
    markdown += `Runs: ${runs.length} selected from \`${folderPath}\`\n\n`;

    // Run Summary Table
    markdown += '## Run Summary\n\n';
    markdown += formatRunSummaryTable(runs, parsedData);
    markdown += '\n';

    // Configuration Comparison (if multiple runs)
    if (runs.length > 1) {
        markdown += '## Configuration Comparison\n\n';
        markdown += formatConfigComparison(runs, parsedData);
        markdown += '\n';
    } else {
        // Single run - show full config
        markdown += '## Configuration\n\n';
        const runData = parsedData.get(runs[0].runId);
        if (runData && runData.config) {
            markdown += formatSingleConfig(runData.config);
        } else {
            markdown += '*No configuration data available*\n';
        }
        markdown += '\n';
    }

    // Metrics Summary
    markdown += '## Metrics Summary\n\n';
    markdown += formatMetricsSection(runs, parsedData);
    markdown += '\n';

    // Detailed Metric Data (collapsible)
    markdown += '## Detailed Metric Data\n\n';
    markdown += formatDetailedMetricData(runs, parsedData);
    markdown += '\n';

    // File References
    markdown += '## File References\n\n';
    markdown += formatFileReferences(runs, folderPath);
    markdown += '\n';

    return markdown;
}

/**
 * Format run summary table
 */
function formatRunSummaryTable(runs: RunScanResult[], parsedData: Map<string, WandbRunData>): string {
    let table = '| Run ID | Name | Key Metrics |\n';
    table += '|--------|------|-------------|\n';

    for (const run of runs) {
        const runData = parsedData.get(run.runId);
        const runId = run.runId.substring(0, 8);
        const name = run.runName || 'unnamed';

        let keyMetrics = '-';
        if (runData && runData.metrics) {
            keyMetrics = getKeyMetricsSummary(runData.metrics);
        }

        table += `| ${runId} | ${name} | ${keyMetrics} |\n`;
    }

    return table;
}

/**
 * Get a brief summary of key metrics for the run summary table
 */
function getKeyMetricsSummary(metrics: WandbMetrics): string {
    const metricNames = Object.keys(metrics);

    // Look for common metrics (loss, accuracy, etc.)
    const keyMetricPatterns = ['loss', 'accuracy', 'acc'];
    const keyMetrics: string[] = [];

    for (const pattern of keyMetricPatterns) {
        const found = metricNames.find(name =>
            name.toLowerCase().includes(pattern) && !name.includes('system')
        );
        if (found && metrics[found].length > 0) {
            const data = metrics[found];
            const initial = data[0].value;
            const final = data[data.length - 1].value;
            keyMetrics.push(`${found}: ${formatNumber(initial)} → ${formatNumber(final)}`);
        }
    }

    return keyMetrics.length > 0 ? keyMetrics.join(', ') : `${metricNames.length} metrics`;
}

/**
 * Format configuration comparison for multiple runs
 */
function formatConfigComparison(runs: RunScanResult[], parsedData: Map<string, WandbRunData>): string {
    // Collect configs
    const runConfigs = new Map<string, any>();
    const runNames = new Map<string, string>();

    for (const run of runs) {
        const runData = parsedData.get(run.runId);
        if (runData && runData.config) {
            runConfigs.set(run.runId, runData.config);
            runNames.set(run.runId, run.runName || run.runId.substring(0, 8));
        }
    }

    if (runConfigs.size === 0) {
        return '*No configuration data available*\n';
    }

    const comparison = compareConfigs(runConfigs);

    let result = '';

    // Common parameters
    result += '### Common Parameters\n\n';
    if (Object.keys(comparison.common).length > 0) {
        result += formatCommonParams(comparison.common, 15);
    } else {
        result += '*No common parameters*\n';
    }
    result += '\n';

    // Differences
    result += '### Differences\n\n';
    if (Object.keys(comparison.differences).length > 0) {
        result += formatDifferences(comparison.differences, runNames);
    } else {
        result += '*No differences found (all configurations identical)*\n';
    }

    return result;
}

/**
 * Format single run configuration
 */
function formatSingleConfig(config: Record<string, any>): string {
    const entries = Object.entries(flattenConfig(config));

    if (entries.length === 0) {
        return '*No configuration parameters*\n';
    }

    let result = '';
    for (const [key, value] of entries) {
        const valueStr = formatValue(value);
        result += `- **${key}**: ${valueStr}\n`;
    }

    return result;
}

/**
 * Format metrics summary section
 */
function formatMetricsSection(runs: RunScanResult[], parsedData: Map<string, WandbRunData>): string {
    // Collect all unique metric names across all runs (excluding system metrics)
    const allMetricNames = new Set<string>();

    for (const run of runs) {
        const runData = parsedData.get(run.runId);
        if (runData && runData.metrics) {
            Object.keys(runData.metrics).forEach(name => {
                if (!name.startsWith('system.') && !name.startsWith('_')) {
                    allMetricNames.add(name);
                }
            });
        }
    }

    if (allMetricNames.size === 0) {
        return '*No training metrics available*\n';
    }

    // Sort metrics (put loss and accuracy first)
    const sortedMetrics = Array.from(allMetricNames).sort((a, b) => {
        const aIsLoss = a.toLowerCase().includes('loss');
        const bIsLoss = b.toLowerCase().includes('loss');
        const aIsAcc = a.toLowerCase().includes('acc');
        const bIsAcc = b.toLowerCase().includes('acc');

        if (aIsLoss && !bIsLoss) return -1;
        if (!aIsLoss && bIsLoss) return 1;
        if (aIsAcc && !bIsAcc) return -1;
        if (!aIsAcc && bIsAcc) return 1;
        return a.localeCompare(b);
    });

    // Limit to top 15 metrics for the summary
    const displayMetrics = sortedMetrics.slice(0, 15);

    let result = '';

    for (const metricName of displayMetrics) {
        result += `### ${metricName}\n\n`;

        for (const run of runs) {
            const runData = parsedData.get(run.runId);
            if (runData && runData.metrics && runData.metrics[metricName]) {
                const summary = summarizeMetric(runData.metrics[metricName]);
                result += formatMetricSummary(metricName, run.runId, run.runName, summary);
            }
        }

        result += '\n';
    }

    if (sortedMetrics.length > 15) {
        result += `*...and ${sortedMetrics.length - 15} more metrics (see detailed data below)*\n\n`;
    }

    return result;
}

/**
 * Format detailed metric data as collapsible CSV sections
 */
function formatDetailedMetricData(runs: RunScanResult[], parsedData: Map<string, WandbRunData>): string {
    // Collect all unique metric names
    const allMetricNames = new Set<string>();

    for (const run of runs) {
        const runData = parsedData.get(run.runId);
        if (runData && runData.metrics) {
            Object.keys(runData.metrics).forEach(name => {
                if (!name.startsWith('system.') && !name.startsWith('_')) {
                    allMetricNames.add(name);
                }
            });
        }
    }

    if (allMetricNames.size === 0) {
        return '*No detailed metric data available*\n';
    }

    let result = '';

    // Limit to top 10 metrics for detailed CSV
    const metricNames = Array.from(allMetricNames).slice(0, 10);

    for (const metricName of metricNames) {
        // Build merged metric structure
        const datasets: Array<{
            runId: string;
            runName: string;
            color: string;
            data: MetricPoint[];
        }> = [];

        for (const run of runs) {
            const runData = parsedData.get(run.runId);
            if (runData && runData.metrics && runData.metrics[metricName]) {
                datasets.push({
                    runId: run.runId,
                    runName: run.runName || run.runId.substring(0, 8),
                    color: '',
                    data: runData.metrics[metricName]
                });
            }
        }

        if (datasets.length > 0) {
            const csv = generateCSV({ metricName, datasets });
            result += `<details>\n`;
            result += `<summary>${metricName} - Full Data (CSV)</summary>\n\n`;
            result += '```csv\n';
            result += csv;
            result += '```\n\n';
            result += `</details>\n\n`;
        }
    }

    if (allMetricNames.size > 10) {
        result += `*Additional ${allMetricNames.size - 10} metrics available in the original .wandb files*\n\n`;
    }

    return result;
}

/**
 * Format file references section
 */
function formatFileReferences(runs: RunScanResult[], folderPath: string): string {
    let result = '';

    for (const run of runs) {
        result += `### ${run.runName || run.runId.substring(0, 8)}\n\n`;

        const runDir = path.dirname(run.filePath);

        // Output log
        const outputLogPath = path.join(runDir, 'output.log');
        result += `- Output log: \`@${outputLogPath}\`\n`;

        // Config
        const configPath = path.join(runDir, 'files', 'config.yaml');
        result += `- Config: \`@${configPath}\`\n`;

        // Metadata
        const metadataPath = path.join(runDir, 'files', 'wandb-metadata.json');
        result += `- Metadata: \`@${metadataPath}\`\n`;

        // Summary
        const summaryPath = path.join(runDir, 'files', 'wandb-summary.json');
        result += `- Summary: \`@${summaryPath}\`\n`;

        result += '\n';
    }

    return result;
}

/**
 * Calculate rough token estimate for the context
 * Uses simple whitespace-based tokenization (~1.3x word count)
 */
export function calculateTokenEstimate(content: string): number {
    // Remove code blocks for more accurate estimate
    const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '');

    // Split on whitespace and punctuation
    const tokens = withoutCodeBlocks.split(/[\s\n\r,.;:!?()[\]{}]+/).filter(t => t.length > 0);

    // Multiply by 1.3 to account for subword tokenization
    return Math.ceil(tokens.length * 1.3);
}

/**
 * Format a value for display
 */
function formatValue(value: any): string {
    if (value === null || value === undefined) {
        return 'null';
    }
    if (typeof value === 'string') {
        return value.length > 100 ? `${value.substring(0, 97)}...` : value;
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
        return str.length > 100 ? `${str.substring(0, 97)}...` : str;
    }
    return String(value);
}
