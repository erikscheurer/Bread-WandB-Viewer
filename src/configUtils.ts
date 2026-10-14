/** Expand object-valued configuration parameters into comparable dotted leaves. */
export function flattenConfig(config: Record<string, any>): Record<string, any> {
    const flattened: Record<string, any> = Object.create(null);
    const visit = (key: string, value: any, depth: number): void => {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            const entries = Object.entries(value);
            if (entries.length > 0 && depth < 64) {
                for (const [childKey, childValue] of entries) {
                    visit(`${key}.${childKey}`, childValue, depth + 1);
                }
                return;
            }
        }
        flattened[key] = value;
    };

    // Explicit dotted parameters take precedence over expanded object leaves.
    const entries = Object.entries(config);
    entries.sort(([left], [right]) => Number(left.includes('.')) - Number(right.includes('.')));
    for (const [key, value] of entries) {
        visit(key, value, 0);
    }
    return flattened;
}
