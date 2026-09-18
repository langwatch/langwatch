"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TraceProvider = void 0;
exports.getGlobalTraceProvider = getGlobalTraceProvider;
const context_1 = require("./context.js");
const config_1 = require("../config.js");
const logger_1 = __importDefault(require("../logger.js"));
const processor_1 = require("./processor.js");
const spans_1 = require("./spans.js");
const traces_1 = require("./traces.js");
const utils_1 = require("./utils.js");
class TraceProvider {
    #multiProcessor;
    #disabled;
    constructor() {
        this.#multiProcessor = new processor_1.MultiTracingProcessor();
        this.#disabled = config_1.tracing.disabled;
        this.#addCleanupListeners();
    }
    /**
     * Add a processor to the list of processors. Each processor will receive all traces/spans.
     *
     * @param processor - The processor to add.
     */
    registerProcessor(processor) {
        this.#multiProcessor.addTraceProcessor(processor);
    }
    /**
     * Set the list of processors. This will replace any existing processors.
     *
     * @param processors - The list of processors to set.
     */
    setProcessors(processors) {
        this.#multiProcessor.setProcessors(processors);
    }
    /**
     * Get the current trace.
     *
     * @returns The current trace.
     */
    getCurrentTrace() {
        return (0, context_1.getCurrentTrace)();
    }
    getCurrentSpan() {
        return (0, context_1.getCurrentSpan)();
    }
    setDisabled(disabled) {
        this.#disabled = disabled;
    }
    startExportLoop() {
        this.#multiProcessor.start();
    }
    createTrace(traceOptions) {
        if (this.#disabled) {
            logger_1.default.debug('Tracing is disabled, Not creating trace %o', traceOptions);
            return new traces_1.NoopTrace();
        }
        const traceId = traceOptions.traceId ?? (0, utils_1.generateTraceId)();
        const name = traceOptions.name ?? 'Agent workflow';
        logger_1.default.debug('Creating trace %s with name %s', traceId, name);
        return new traces_1.Trace({ ...traceOptions, name, traceId }, this.#multiProcessor);
    }
    createSpan(spanOptions, parent) {
        if (this.#disabled || spanOptions.disabled) {
            logger_1.default.debug('Tracing is disabled, Not creating span %o', spanOptions);
            return new spans_1.NoopSpan(spanOptions.data, this.#multiProcessor);
        }
        let parentId;
        let traceId;
        let tracingApiKey;
        if (!parent) {
            const currentTrace = (0, context_1.getCurrentTrace)();
            const currentSpan = (0, context_1.getCurrentSpan)();
            if (!currentTrace) {
                logger_1.default.error('No active trace. Make sure to start a trace with `withTrace()` first. Returning NoopSpan.');
                return new spans_1.NoopSpan(spanOptions.data, this.#multiProcessor);
            }
            if (currentSpan instanceof spans_1.NoopSpan ||
                currentTrace instanceof traces_1.NoopTrace) {
                logger_1.default.debug(`Parent ${currentSpan} or ${currentTrace} is no-op, returning NoopSpan`);
                return new spans_1.NoopSpan(spanOptions.data, this.#multiProcessor);
            }
            traceId = currentTrace.traceId;
            tracingApiKey = currentTrace.tracingApiKey;
            if (currentSpan) {
                logger_1.default.debug('Using parent span %s', currentSpan.spanId);
                parentId = currentSpan.spanId;
            }
            else {
                logger_1.default.debug('No parent span, using current trace %s', currentTrace.traceId);
            }
        }
        else if (parent instanceof traces_1.Trace) {
            if (parent instanceof traces_1.NoopTrace) {
                logger_1.default.debug('Parent trace is no-op, returning NoopSpan');
                return new spans_1.NoopSpan(spanOptions.data, this.#multiProcessor);
            }
            traceId = parent.traceId;
            tracingApiKey = parent.tracingApiKey;
        }
        else if (parent instanceof spans_1.Span) {
            if (parent instanceof spans_1.NoopSpan) {
                logger_1.default.debug('Parent span is no-op, returning NoopSpan');
                return new spans_1.NoopSpan(spanOptions.data, this.#multiProcessor);
            }
            parentId = parent.spanId;
            traceId = parent.traceId;
            tracingApiKey = parent.tracingApiKey;
        }
        if (!traceId) {
            logger_1.default.error('No traceId found. Make sure to start a trace with `withTrace()` first. Returning NoopSpan.');
            return new spans_1.NoopSpan(spanOptions.data, this.#multiProcessor);
        }
        logger_1.default.debug(`Creating span ${JSON.stringify(spanOptions.data)} with id ${spanOptions.spanId ?? traceId}`);
        return new spans_1.Span({
            ...spanOptions,
            traceId,
            parentId,
            tracingApiKey: tracingApiKey ?? spanOptions.tracingApiKey,
        }, this.#multiProcessor);
    }
    async shutdown(timeout) {
        try {
            logger_1.default.debug('Shutting down tracing provider');
            await this.#multiProcessor.shutdown(timeout);
        }
        catch (error) {
            logger_1.default.error('Error shutting down tracing provider %o', error);
        }
    }
    /** Adds listeners to `process` to ensure `shutdown` occurs before exit. */
    #addCleanupListeners() {
        if (typeof process !== 'undefined' && typeof process.on === 'function') {
            // handling Node.js process termination
            const cleanup = async () => {
                const timeout = setTimeout(() => {
                    console.warn('Cleanup timeout, forcing exit');
                    process.exit(1);
                }, 5000);
                try {
                    await this.shutdown();
                }
                finally {
                    clearTimeout(timeout);
                }
            };
            // Handle normal termination
            process.on('beforeExit', cleanup);
            // Handle CTRL+C (SIGINT)
            process.on('SIGINT', async () => {
                await cleanup();
                if (!hasOtherListenersForSignals('SIGINT')) {
                    // Only when there are no other listeners, exit the process on this SDK side
                    process.exit(130);
                }
            });
            // Handle termination (SIGTERM)
            process.on('SIGTERM', async () => {
                await cleanup();
                if (!hasOtherListenersForSignals('SIGTERM')) {
                    // Only when there are no other listeners, exit the process on this SDK side
                    process.exit(0);
                }
            });
            process.on('unhandledRejection', async (reason, promise) => {
                logger_1.default.error('Unhandled rejection', reason, promise);
                await cleanup();
                if (!hasOtherListenersForEvents('unhandledRejection')) {
                    // Only when there are no other listeners, exit the process on this SDK side
                    process.exit(1);
                }
            });
        }
    }
    async forceFlush() {
        await this.#multiProcessor.forceFlush();
    }
}
exports.TraceProvider = TraceProvider;
let moduleTraceProvider;
function hasOtherListenersForSignals(event) {
    return process.listeners(event).length > 1;
}
function hasOtherListenersForEvents(event) {
    return process.listeners(event).length > 1;
}
function getGlobalTraceProvider() {
    const symbol = Symbol.for('openai.agents.core.traceProvider');
    try {
        const globalHolder = globalThis;
        // Avoid constructing extra providers when globalThis is frozen/sealed. We
        // first short-circuit on existing instances, then check writability before
        // instantiation so hardened runtimes do not leak constructors or listeners.
        const existing = globalHolder[symbol];
        if (existing) {
            return existing;
        }
        const descriptor = Object.getOwnPropertyDescriptor(globalHolder, symbol);
        if (descriptor &&
            descriptor.writable === false &&
            descriptor.configurable === false &&
            !descriptor.set) {
            return getModuleTraceProvider();
        }
        if (!descriptor) {
            try {
                Object.defineProperty(globalHolder, symbol, {
                    value: undefined,
                    writable: true,
                    configurable: true,
                });
            }
            catch {
                return getModuleTraceProvider();
            }
        }
        try {
            const provider = new TraceProvider();
            globalHolder[symbol] = provider;
            return provider;
        }
        catch {
            return getModuleTraceProvider();
        }
    }
    catch {
        // Hardened runtimes can freeze or seal globalThis; fall back to a
        // module-local singleton instead of throwing so tracing still works.
        return getModuleTraceProvider();
    }
}
function getModuleTraceProvider() {
    if (!moduleTraceProvider) {
        moduleTraceProvider = new TraceProvider();
    }
    return moduleTraceProvider;
}
//# sourceMappingURL=provider.js.map