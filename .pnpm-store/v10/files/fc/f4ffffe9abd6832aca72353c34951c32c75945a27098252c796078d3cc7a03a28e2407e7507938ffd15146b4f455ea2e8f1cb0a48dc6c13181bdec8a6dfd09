export type EventEmitterEvents = Record<string, any[]>;
export interface EventEmitter<EventTypes extends EventEmitterEvents = Record<string, any[]>> {
    on<K extends keyof EventTypes>(type: K, listener: (...args: EventTypes[K]) => void): EventEmitter<EventTypes>;
    off<K extends keyof EventTypes>(type: K, listener: (...args: EventTypes[K]) => void): EventEmitter<EventTypes>;
    emit<K extends keyof EventTypes>(type: K, ...args: EventTypes[K]): boolean;
    once<K extends keyof EventTypes>(type: K, listener: (...args: EventTypes[K]) => void): EventEmitter<EventTypes>;
}
interface ReadableStreamAsyncIterator<T> extends AsyncIterator<T, unknown, unknown> {
    [Symbol.asyncIterator](): ReadableStreamAsyncIterator<T>;
}
export interface ReadableStream<R = any> {
    values(options?: {
        preventCancel?: boolean;
    }): ReadableStreamAsyncIterator<R>;
    [Symbol.asyncIterator](): ReadableStreamAsyncIterator<R>;
}
export interface Timeout {
    ref(): this;
    unref(): this;
    hasRef(): boolean;
    refresh(): this;
}
export interface Timer {
    setTimeout(callback: (...args: any[]) => any, ms: number): Timeout;
    clearTimeout(timeoutId: Timeout | string | number | undefined): void;
}
export {};
