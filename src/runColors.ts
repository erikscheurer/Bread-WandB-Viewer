/**
 * Shared chart palette and deterministic run-color assignment.
 */
export const RUN_COLORS = [
    '#4dc9f6', '#f67019', '#f53794', '#537bc4', '#acc236',
    '#166a8f', '#00a950', '#58595b', '#8549ba', '#ff6384'
] as const;

/**
 * Map a run ID to a stable palette entry without depending on discovery order.
 */
export function getStableRunColor(runId: string): string {
    let hash = 2166136261;
    for (let index = 0; index < runId.length; index++) {
        hash ^= runId.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return RUN_COLORS[(hash >>> 0) % RUN_COLORS.length];
}
