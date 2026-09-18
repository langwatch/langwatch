export { EventEmitter, EventEmitterEvents } from './interface';
import { EventEmitter, Timeout, Timer } from './interface';
export declare function loadEnv(): Record<string, string | undefined>;
type EventMap = Record<string, any[]>;
export declare class BrowserEventEmitter<EventTypes extends EventMap = Record<string, any[]>> implements EventEmitter<EventTypes> {
    #private;
    on<K extends keyof EventTypes>(type: K, listener: (...args: EventTypes[K]) => void): this;
    off<K extends keyof EventTypes>(type: K, listener: (...args: EventTypes[K]) => void): this;
    emit<K extends keyof EventTypes>(type: K, ...args: EventTypes[K]): boolean;
    once<K extends keyof EventTypes>(type: K, listener: (...args: EventTypes[K]) => void): this;
}
export { BrowserEventEmitter as RuntimeEventEmitter };
export declare const randomUUID: () => `${string}-${string}-${string}-${string}-${string}`;
export declare const Readable: {
    new (): {
        pipeTo(_destination: WritableStream, _options?: {
            preventClose?: boolean;
            preventAbort?: boolean;
            preventCancel?: boolean;
        }): void;
        pipeThrough(_transform: TransformStream, _options?: {
            preventClose?: boolean;
            preventAbort?: boolean;
            preventCancel?: boolean;
        }): void;
    };
};
export declare const ReadableStream: {
    new (underlyingSource: UnderlyingByteSource, strategy?: {
        highWaterMark?: number;
    }): ReadableStream<Uint8Array<ArrayBuffer>>;
    new <R = any>(underlyingSource: UnderlyingDefaultSource<R>, strategy?: QueuingStrategy<R>): ReadableStream<R>;
    new <R = any>(underlyingSource?: UnderlyingSource<R>, strategy?: QueuingStrategy<R>): ReadableStream<R>;
    prototype: ReadableStream;
};
export declare const ReadableStreamController: {
    new (): ReadableStreamDefaultController;
    prototype: ReadableStreamDefaultController;
};
export declare const TransformStream: {
    new <I = any, O = any>(transformer?: Transformer<I, O>, writableStrategy?: QueuingStrategy<I>, readableStrategy?: QueuingStrategy<O>): TransformStream<I, O>;
    prototype: TransformStream;
};
export declare class AsyncLocalStorage {
    context: null;
    constructor();
    run(context: any, fn: () => any): any;
    getStore(): null;
    enterWith(context: any): void;
}
export declare function isBrowserEnvironment(): boolean;
export declare function isTracingLoopRunningByDefault(): boolean;
export { MCPServerStdio, MCPServerStreamableHttp, MCPServerSSE, } from './mcp-server/browser';
declare class BrowserTimer implements Timer {
    constructor();
    setTimeout(callback: () => void, ms: number): Timeout;
    clearTimeout(timeoutId: Timeout | string | number | undefined): void;
}
declare const timer: BrowserTimer;
export { timer };
