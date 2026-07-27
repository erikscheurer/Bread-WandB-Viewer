/**
 * Shared chart palette and deterministic run-color assignment.
 */
export const RUN_COLORS = [
    '#1f77b4', '#aec7e8', '#ff7f0e', '#ffbb78', '#2ca02c',
    '#98df8a', '#d62728', '#ff9896', '#9467bd', '#c5b0d5',
    '#8c564b', '#c49c94', '#e377c2', '#f7b6d2', '#7f7f7f',
    '#c7c7c7', '#bcbd22', '#dbdb8d', '#17becf', '#9edae5'
] as const;

/**
 * Map a run ID to a stable palette entry without depending on discovery order.
 */
export function getStableRunColor(runId: string): string {
    let hash = 117;
    for (let index = 0; index < runId.length; index++) {
        hash ^= runId.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return RUN_COLORS[(hash >>> 0) % RUN_COLORS.length];
}
