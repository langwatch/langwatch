"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentTrace = getCurrentTrace;
exports.getCurrentSpan = getCurrentSpan;
exports.withTrace = withTrace;
exports.getOrCreateTrace = getOrCreateTrace;
exports.setCurrentSpan = setCurrentSpan;
exports.resetCurrentSpan = resetCurrentSpan;
exports.addErrorToCurrentSpan = addErrorToCurrentSpan;
exports.cloneCurrentContext = cloneCurrentContext;
exports.withNewSpanContext = withNewSpanContext;
const _shims_1 = require("@openai/agents-core/_shims");
const provider_1 = require("./provider.js");
const result_1 = require("../result.js");
const ALS_SYMBOL = Symbol.for('openai.agents.core.asyncLocalStorage');
let localFallbackAls;
// Global symbols ensure that if multiple copies of agents-core are loaded
// (e.g., via different npm resolution paths or bundlers), they all share the
// same AsyncLocalStorage instance. This prevents losing trace/span state when a
// downstream package pulls in a duplicate copy.
function getContextAsyncLocalStorage() {
    try {
        const globalScope = globalThis;
        const globalALS = globalScope[ALS_SYMBOL];
        if (globalALS) {
            return globalALS;
        }
        const newALS = new _shims_1.AsyncLocalStorage();
        globalScope[ALS_SYMBOL] = newALS;
        return newALS;
    }
    catch {
        // As a defensive fallback (e.g., if globalThis is locked down or ALS
        // construction throws in a constrained runtime), keep a module-local ALS so
        // tracing still functions instead of crashing callers.
        if (!localFallbackAls) {
            localFallbackAls = new _shims_1.AsyncLocalStorage();
        }
        return localFallbackAls;
    }
}
function getActiveContext() {
    const store = getContextAsyncLocalStorage().getStore();
    if (store?.active === true) {
        return store;
    }
    return undefined;
}
/**
 * This function will get the current trace from the execution context.
 *
 * @returns The current trace or null if there is no trace.
 */
function getCurrentTrace() {
    const currentTrace = getActiveContext();
    if (currentTrace?.trace) {
        return currentTrace.trace;
    }
    return null;
}
/**
 * This function will get the current span from the execution context.
 *
 * @returns The current span or null if there is no span.
 */
function getCurrentSpan() {
    const currentSpan = getActiveContext();
    if (currentSpan?.span) {
        return currentSpan.span;
    }
    return null;
}
/**
 * This is an AsyncLocalStorage instance that stores the current trace.
 * It will automatically handle the execution context of different event loop executions.
 *
 * The functions below should be the only way that this context gets interfaced with.
 */
function _wrapFunctionWithTraceLifecycle(fn, currentContext, previousAlsStore) {
    return async () => {
        const trace = getCurrentTrace();
        if (!trace) {
            throw new Error('No trace found');
        }
        let cleanupDeferred = false;
        let started = false;
        const cleanupContext = () => {
            currentContext.active = false;
            currentContext.trace = undefined;
            currentContext.span = undefined;
            currentContext.previousSpan = undefined;
            getContextAsyncLocalStorage().enterWith(previousAlsStore);
        };
        try {
            await trace.start();
            started = true;
            const result = await fn(trace);
            // If result is a StreamedRunResult, defer trace end until stream loop completes
            if (result instanceof result_1.StreamedRunResult) {
                const streamLoopPromise = result._getStreamLoopPromise();
                if (streamLoopPromise) {
                    cleanupDeferred = true;
                    streamLoopPromise.finally(async () => {
                        try {
                            if (started) {
                                await trace.end();
                            }
                        }
                        finally {
                            cleanupContext();
                        }
                    });
                    return result;
                }
            }
            // For non-streaming results, end trace synchronously
            if (started) {
                await trace.end();
            }
            return result;
        }
        finally {
            // If cleanup was deferred to the streaming loop, keep the context marked
            // active so concurrent traces do not clear it prematurely. Otherwise,
            // mark inactive and restore now.
            if (!cleanupDeferred) {
                cleanupContext();
            }
        }
    };
}
/**
 * This function will create a new trace and assign it to the execution context of the function
 * passed to it.
 *
 * @param fn - The function to run and assign the trace context to.
 * @param options - Options for the creation of the trace
 */
async function withTrace(trace, fn, options = {}) {
    const newTrace = typeof trace === 'string'
        ? (0, provider_1.getGlobalTraceProvider)().createTrace({
            ...options,
            name: trace,
        })
        : trace;
    const context = {
        trace: newTrace,
        active: true,
    };
    const previousAlsStore = getContextAsyncLocalStorage().getStore();
    return getContextAsyncLocalStorage().run(context, _wrapFunctionWithTraceLifecycle(fn, context, previousAlsStore));
}
/**
 * This function will check if there is an existing active trace in the execution context. If there
 * is, it will run the given function with the existing trace. If there is no trace, it will create
 * a new one and assign it to the execution context of the function.
 *
 * @param fn - The fzunction to run and assign the trace context to.
 * @param options - Options for the creation of the trace
 */
async function getOrCreateTrace(fn, options = {}) {
    const currentTrace = getCurrentTrace();
    if (currentTrace) {
        return await fn();
    }
    const newTrace = (0, provider_1.getGlobalTraceProvider)().createTrace(options);
    const newContext = {
        trace: newTrace,
        active: true,
    };
    const previousAlsStore = getContextAsyncLocalStorage().getStore();
    return getContextAsyncLocalStorage().run(newContext, _wrapFunctionWithTraceLifecycle(fn, newContext, previousAlsStore));
}
/**
 * This function will set the current span in the execution context.
 *
 * @param span - The span to set as the current span.
 */
function setCurrentSpan(span) {
    const context = getActiveContext();
    if (!context) {
        throw new Error('No existing trace found');
    }
    if (context.span) {
        context.span.previousSpan = context.previousSpan;
        context.previousSpan = context.span;
    }
    span.previousSpan = context.span ?? context.previousSpan;
    context.span = span;
    getContextAsyncLocalStorage().enterWith(context);
}
function resetCurrentSpan() {
    const context = getActiveContext();
    if (context) {
        context.span = context.previousSpan;
        context.previousSpan = context.previousSpan?.previousSpan;
        getContextAsyncLocalStorage().enterWith(context);
    }
}
/**
 * This function will add an error to the current span.
 *
 * @param spanError - The error to add to the current span.
 */
function addErrorToCurrentSpan(spanError) {
    const currentSpan = getCurrentSpan();
    if (currentSpan) {
        currentSpan.setError(spanError);
    }
}
/**
 * This function will clone the current context by creating new instances of the trace, span, and
 * previous span.
 *
 * @param context - The context to clone.
 * @returns A clone of the context.
 */
function cloneCurrentContext(context) {
    return {
        trace: context.trace?.clone(),
        span: context.span?.clone(),
        previousSpan: context.previousSpan?.clone(),
        active: context.active,
    };
}
/**
 * This function will run the given function with a new span context.
 *
 * @param fn - The function to run with the new span context.
 */
function withNewSpanContext(fn) {
    const currentContext = getActiveContext();
    if (!currentContext) {
        return fn();
    }
    const copyOfContext = cloneCurrentContext(currentContext);
    return getContextAsyncLocalStorage().run(copyOfContext, fn);
}
//# sourceMappingURL=context.js.map