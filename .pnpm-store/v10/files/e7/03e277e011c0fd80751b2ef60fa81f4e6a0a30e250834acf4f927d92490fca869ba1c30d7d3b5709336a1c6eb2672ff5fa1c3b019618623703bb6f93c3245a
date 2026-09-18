"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMCPToolStaticFilter = createMCPToolStaticFilter;
/** Convenience helper to create a static tool filter. */
function createMCPToolStaticFilter(options) {
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
//# sourceMappingURL=mcpUtil.js.map