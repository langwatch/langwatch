"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.timer = exports.MCPServerSSE = exports.MCPServerStreamableHttp = exports.MCPServerStdio = exports.AsyncLocalStorage = exports.TransformStream = exports.ReadableStreamController = exports.ReadableStream = exports.Readable = exports.randomUUID = exports.RuntimeEventEmitter = void 0;
exports.loadEnv = loadEnv;
exports.isBrowserEnvironment = isBrowserEnvironment;
exports.isTracingLoopRunningByDefault = isTracingLoopRunningByDefault;
const process = __importStar(require("node:process"));
const node_async_hooks_1 = require("node:async_hooks");
var node_events_1 = require("node:events");
Object.defineProperty(exports, "RuntimeEventEmitter", { enumerable: true, get: function () { return node_events_1.EventEmitter; } });
// Use function instead of exporting the value to prevent
// circular dependency resolution issues caused by other exports in '@openai/agents-core/_shims'
function loadEnv() {
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
var node_crypto_1 = require("node:crypto");
Object.defineProperty(exports, "randomUUID", { enumerable: true, get: function () { return node_crypto_1.randomUUID; } });
var node_stream_1 = require("node:stream");
Object.defineProperty(exports, "Readable", { enumerable: true, get: function () { return node_stream_1.Readable; } });
exports.ReadableStream = globalThis.ReadableStream;
exports.ReadableStreamController = globalThis.ReadableStreamDefaultController;
exports.TransformStream = globalThis.TransformStream;
class AsyncLocalStorage extends node_async_hooks_1.AsyncLocalStorage {
    enterWith(context) {
        // Cloudflare workers does not support enterWith, so we need to use run instead
        super.run(context, () => { });
    }
}
exports.AsyncLocalStorage = AsyncLocalStorage;
function isBrowserEnvironment() {
    return false;
}
function isTracingLoopRunningByDefault() {
    // Cloudflare workers does not support triggering things like setTimeout outside of the
    // request context. So we don't run the trace export loop by default.
    return false;
}
/**
 * Use the Node versions of MCP helpers
 */
var node_1 = require("./mcp-server/node.js");
Object.defineProperty(exports, "MCPServerStdio", { enumerable: true, get: function () { return node_1.NodeMCPServerStdio; } });
Object.defineProperty(exports, "MCPServerStreamableHttp", { enumerable: true, get: function () { return node_1.NodeMCPServerStreamableHttp; } });
Object.defineProperty(exports, "MCPServerSSE", { enumerable: true, get: function () { return node_1.NodeMCPServerSSE; } });
var node_timers_1 = require("node:timers");
Object.defineProperty(exports, "clearTimeout", { enumerable: true, get: function () { return node_timers_1.clearTimeout; } });
Object.defineProperty(exports, "setTimeout", { enumerable: true, get: function () { return node_timers_1.setTimeout; } });
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
exports.timer = timer;
//# sourceMappingURL=shims-workerd.js.map