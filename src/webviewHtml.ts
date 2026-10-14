/** Escape run-derived text before placing it in webview HTML or attributes. */
export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]!);
}

/** Serialize data without allowing logged text to close an inline script. */
export function serializeForScript(value: unknown): string {
    return (JSON.stringify(value) ?? 'null').replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}
