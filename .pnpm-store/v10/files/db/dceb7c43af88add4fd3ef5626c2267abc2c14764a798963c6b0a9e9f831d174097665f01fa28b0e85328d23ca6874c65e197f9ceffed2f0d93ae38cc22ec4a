import { Trace, TraceOptions } from './traces';
import { Span, SpanError } from './spans';
type ContextState = {
    trace?: Trace;
    span?: Span<any>;
    previousSpan?: Span<any>;
    active: boolean;
};
/**
 * This function will get the current trace from the execution context.
 *
 * @returns The current trace or null if there is no trace.
 */
export declare function getCurrentTrace(): Trace | null;
/**
 * This function will get the current span from the execution context.
 *
 * @returns The current span or null if there is no span.
 */
export declare function getCurrentSpan(): Span<any> | null;
/**
 * This function will create a new trace and assign it to the execution context of the function
 * passed to it.
 *
 * @param fn - The function to run and assign the trace context to.
 * @param options - Options for the creation of the trace
 */
export declare function withTrace<T>(trace: string | Trace, fn: (trace: Trace) => Promise<T>, options?: TraceOptions): Promise<T>;
/**
 * This function will check if there is an existing active trace in the execution context. If there
 * is, it will run the given function with the existing trace. If there is no trace, it will create
 * a new one and assign it to the execution context of the function.
 *
 * @param fn - The fzunction to run and assign the trace context to.
 * @param options - Options for the creation of the trace
 */
export declare function getOrCreateTrace<T>(fn: () => Promise<T>, options?: TraceOptions): Promise<T>;
/**
 * This function will set the current span in the execution context.
 *
 * @param span - The span to set as the current span.
 */
export declare function setCurrentSpan(span: Span<any>): void;
export declare function resetCurrentSpan(): void;
/**
 * This function will add an error to the current span.
 *
 * @param spanError - The error to add to the current span.
 */
export declare function addErrorToCurrentSpan(spanError: SpanError): void;
/**
 * This function will clone the current context by creating new instances of the trace, span, and
 * previous span.
 *
 * @param context - The context to clone.
 * @returns A clone of the context.
 */
export declare function cloneCurrentContext(context: ContextState): {
    trace: Trace | undefined;
    span: Span<any> | undefined;
    previousSpan: Span<any> | undefined;
    active: boolean;
};
/**
 * This function will run the given function with a new span context.
 *
 * @param fn - The function to run with the new span context.
 */
export declare function withNewSpanContext<T>(fn: () => Promise<T>): Promise<T>;
export {};
