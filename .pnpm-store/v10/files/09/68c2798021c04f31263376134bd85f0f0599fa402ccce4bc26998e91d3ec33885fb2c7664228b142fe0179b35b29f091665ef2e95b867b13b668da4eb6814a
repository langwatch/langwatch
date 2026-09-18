/// <reference lib="dom" />
// Use function instead of exporting the value to prevent
// circular dependency resolution issues caused by other exports in '@openai/agents-core/_shims'
export function loadEnv() {
    return {};
}
export class BrowserEventEmitter {
    #target = new EventTarget();
    #listenerWrappers = new Map();
    on(type, listener) {
        const eventType = type;
        let listenersForType = this.#listenerWrappers.get(eventType);
        if (!listenersForType) {
            listenersForType = new Map();
            this.#listenerWrappers.set(eventType, listenersForType);
        }
        let wrappers = listenersForType.get(listener);
        if (!wrappers) {
            wrappers = new Set();
            listenersForType.set(listener, wrappers);
        }
        const wrapper = ((event) => listener(...(event.detail ?? [])));
        wrappers.add(wrapper);
        this.#target.addEventListener(eventType, wrapper);
        return this;
    }
    off(type, listener) {
        const eventType = type;
        const listenersForType = this.#listenerWrappers.get(eventType);
        const wrappers = listenersForType?.get(listener);
        if (wrappers?.size) {
            for (const wrapper of wrappers) {
                this.#target.removeEventListener(eventType, wrapper);
            }
            listenersForType?.delete(listener);
            if (listenersForType?.size === 0) {
                this.#listenerWrappers.delete(eventType);
            }
        }
        return this;
    }
    emit(type, ...args) {
        const event = new CustomEvent(type, { detail: args });
        return this.#target.dispatchEvent(event);
    }
    once(type, listener) {
        const handler = (...args) => {
            this.off(type, handler);
            listener(...args);
        };
        this.on(type, handler);
        return this;
    }
}
export { BrowserEventEmitter as RuntimeEventEmitter };
export const randomUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};
export const Readable = class Readable {
    constructor() { }
    pipeTo(_destination, _options) { }
    pipeThrough(_transform, _options) { }
};
export const ReadableStream = globalThis.ReadableStream;
export const ReadableStreamController = globalThis.ReadableStreamDefaultController;
export const TransformStream = globalThis.TransformStream;
export class AsyncLocalStorage {
    context = null;
    constructor() { }
    run(context, fn) {
        this.context = context;
        return fn();
    }
    getStore() {
        return this.context;
    }
    enterWith(context) {
        this.context = context;
    }
}
export function isBrowserEnvironment() {
    return true;
}
export function isTracingLoopRunningByDefault() {
    return false;
}
export { MCPServerStdio, MCPServerStreamableHttp, MCPServerSSE, } from "./mcp-server/browser.mjs";
class BrowserTimer {
    constructor() { }
    setTimeout(callback, ms) {
        const timeout = setTimeout(callback, ms);
        timeout.ref =
            typeof timeout.ref === 'function' ? timeout.ref : () => timeout;
        timeout.unref =
            typeof timeout.unref === 'function' ? timeout.unref : () => timeout;
        timeout.hasRef =
            typeof timeout.hasRef === 'function' ? timeout.hasRef : () => true;
        timeout.refresh =
            typeof timeout.refresh === 'function' ? timeout.refresh : () => timeout;
        return timeout;
    }
    clearTimeout(timeoutId) {
        window.clearTimeout(timeoutId);
    }
}
const timer = new BrowserTimer();
export { timer };
//# sourceMappingURL=shims-browser.mjs.map