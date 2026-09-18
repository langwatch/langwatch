/** Convenience helper to create a static tool filter. */
export function createMCPToolStaticFilter(options) {
    if (!options?.allowed && !options?.blocked) {
        return undefined;
    }
    const filter = {};
    if (options?.allowed) {
        filter.allowedToolNames = options.allowed;
    }
    if (options?.blocked) {
        filter.blockedToolNames = options.blocked;
    }
    return filter;
}
//# sourceMappingURL=mcpUtil.mjs.map