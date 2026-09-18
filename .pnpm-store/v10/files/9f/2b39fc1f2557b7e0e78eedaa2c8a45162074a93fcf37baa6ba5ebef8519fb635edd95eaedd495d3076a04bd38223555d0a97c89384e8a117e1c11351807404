import { Timeout, Timer } from './interface';
export { EventEmitter, EventEmitterEvents } from './interface';
export { EventEmitter as RuntimeEventEmitter } from 'node:events';
declare global {
    interface ImportMeta {
        env?: Record<string, string | undefined>;
    }
}
export declare function loadEnv(): Record<string, string | undefined>;
export { randomUUID } from 'node:crypto';
export { Readable } from 'node:stream';
export { ReadableStream, ReadableStreamController, TransformStream, } from 'node:stream/web';
export { AsyncLocalStorage } from 'node:async_hooks';
export declare function isTracingLoopRunningByDefault(): boolean;
export declare function isBrowserEnvironment(): boolean;
export { NodeMCPServerStdio as MCPServerStdio, NodeMCPServerStreamableHttp as MCPServerStreamableHttp, NodeMCPServerSSE as MCPServerSSE, } from './mcp-server/node';
export { clearTimeout } from 'node:timers';
declare class NodeTimer implements Timer {
    constructor();
    setTimeout(callback: () => void, ms: number): Timeout;
    clearTimeout(timeoutId: Timeout | string | number | undefined): void;
}
declare const timer: NodeTimer;
export { timer };
