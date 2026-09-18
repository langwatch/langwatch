import { getCurrentSpan, getCurrentTrace } from "./context.mjs";
import { tracing } from "../config.mjs";
import logger from "../logger.mjs";
import { MultiTracingProcessor } from "./processor.mjs";
import { NoopSpan, Span } from "./spans.mjs";
import { NoopTrace, Trace } from "./traces.mjs";
import { generateTraceId } from "./utils.mjs";
export class TraceProvider {
    #multiProcessor;
    #disabled;
    constructor() {
        this.#multiProcessor = new MultiTracingProcessor();
        this.#disabled = tracing.disabled;
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
        return getCurrentTrace();
    }
    getCurrentSpan() {
        return getCurrentSpan();
    }
    setDisabled(disabled) {
        this.#disabled = disabled;
    }
    startExportLoop() {
        this.#multiProcessor.start();
    }
    createTrace(traceOptions) {
        if (this.#disabled) {
            logger.debug('Tracing is disabled, Not creating trace %o', traceOptions);
            return new NoopTrace();
        }
        const traceId = traceOptions.traceId ?? generateTraceId();
        const name = traceOptions.name ?? 'Agent workflow';
        logger.debug('Creating trace %s with name %s', traceId, name);
        return new Trace({ ...traceOptions, name, traceId }, this.#multiProcessor);
    }
    createSpan(spanOptions, parent) {
        if (this.#disabled || spanOptions.disabled) {
            logger.debug('Tracing is disabled, Not creating span %o', spanOptions);
            return new NoopSpan(spanOptions.data, this.#multiProcessor);
        }
        let parentId;
        let traceId;
        let tracingApiKey;
        if (!parent) {
            const currentTrace = getCurrentTrace();
            const currentSpan = getCurrentSpan();
            if (!currentTrace) {
                logger.error('No active trace. Make sure to start a trace with `withTrace()` first. Returning NoopSpan.');
                return new NoopSpan(spanOptions.data, this.#multiProcessor);
            }
            if (currentSpan instanceof NoopSpan ||
                currentTrace instanceof NoopTrace) {
                logger.debug(`Parent ${currentSpan} or ${currentTrace} is no-op, returning NoopSpan`);
                return new NoopSpan(spanOptions.data, this.#multiProcessor);
            }
            traceId = currentTrace.traceId;
            tracingApiKey = currentTrace.tracingApiKey;
            if (currentSpan) {
                logger.debug('Using parent span %s', currentSpan.spanId);
                parentId = currentSpan.spanId;
            }
            else {
                logger.debug('No parent span, using current trace %s', currentTrace.traceId);
            }
        }
        else if (parent instanceof Trace) {
            if (parent instanceof NoopTrace) {
                logger.debug('Parent trace is no-op, returning NoopSpan');
                return new NoopSpan(spanOptions.data, this.#multiProcessor);
            }
            traceId = parent.traceId;
            tracingApiKey = parent.tracingApiKey;
        }
        else if (parent instanceof Span) {
            if (parent instanceof NoopSpan) {
                logger.debug('Parent span is no-op, returning NoopSpan');
                return new NoopSpan(spanOptions.data, this.#multiProcessor);
            }
            parentId = parent.spanId;
            traceId = parent.traceId;
            tracingApiKey = parent.tracingApiKey;
        }
        if (!traceId) {
            logger.error('No traceId found. Make sure to start a trace with `withTrace()` first. Returning NoopSpan.');
            return new NoopSpan(spanOptions.data, this.#multiProcessor);
        }
        logger.debug(`Creating span ${JSON.stringify(spanOptions.data)} with id ${spanOptions.spanId ?? traceId}`);
        return new Span({
            ...spanOptions,
            traceId,
            parentId,
            tracingApiKey: tracingApiKey ?? spanOptions.tracingApiKey,
        }, this.#multiProcessor);
    }
    async shutdown(timeout) {
        try {
            logger.debug('Shutting down tracing provider');
            await this.#multiProcessor.shutdown(timeout);
        }
        catch (error) {
            logger.error('Error shutting down tracing provider %o', error);
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
                logger.error('Unhandled rejection', reason, promise);
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
let moduleTraceProvider;
function hasOtherListenersForSignals(event) {
    return process.listeners(event).length > 1;
}
function hasOtherListenersForEvents(event) {
    return process.listeners(event).length > 1;
}
export function getGlobalTraceProvider() {
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
//# sourceMappingURL=provider.mjs.map