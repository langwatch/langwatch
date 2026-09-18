import * as process from 'node:process';
export { EventEmitter as RuntimeEventEmitter } from 'node:events';
// Use function instead of exporting the value to prevent
// circular dependency resolution issues caused by other exports in '@openai/agents-core/_shims'
export function loadEnv() {
    if (typeof process === 'undefined' || typeof process.env === 'undefined') {
        // In CommonJS builds, import.meta is not available, so we return empty object
        try {
            // Use eval to avoid TypeScript compilation errors in CommonJS builds
            const importMeta = (0, eval)('import.meta');
            if (typeof importMeta === 'object' &&
                typeof importMeta.env === 'object') {
                return importMeta.env;
            }
        }
        catch {
            // import.meta not available (CommonJS build)
        }
        return {};
    }
    return process.env;
}
export { randomUUID } from 'node:crypto';
export { Readable } from 'node:stream';
export { ReadableStream, TransformStream, } from 'node:stream/web';
export { AsyncLocalStorage } from 'node:async_hooks';
export function isTracingLoopRunningByDefault() {
    return true;
}
export function isBrowserEnvironment() {
    return false;
}
export { NodeMCPServerStdio as MCPServerStdio, NodeMCPServerStreamableHttp as MCPServerStreamableHttp, NodeMCPServerSSE as MCPServerSSE, } from "./mcp-server/node.mjs";
export { clearTimeout } from 'node:timers';
class NodeTimer {
    constructor() { }
    setTimeout(callback, ms) {
        return setTimeout(callback, ms);
    }
    clearTimeout(timeoutId) {
        clearTimeout(timeoutId);
    }
}
const timer = new NodeTimer();
export { timer };
//# sourceMappingURL=shims-node.mjs.map