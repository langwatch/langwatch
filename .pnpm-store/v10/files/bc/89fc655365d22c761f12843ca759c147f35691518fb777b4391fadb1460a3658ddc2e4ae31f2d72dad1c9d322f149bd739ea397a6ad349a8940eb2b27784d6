import { Span as TSpan } from './spans';
import { Trace } from './traces';
type Span = TSpan<any>;
/**
 * Interface for processing traces
 */
export interface TracingProcessor {
    /**
     * Called when the trace processor should start processing traces.
     * Only available if the processor is performing tasks like exporting traces in a loop to start
     * the loop
     */
    start?(): void;
    /***
     * Called when a trace is started
     */
    onTraceStart(trace: Trace): Promise<void>;
    /**
     * Called when a trace is ended
     */
    onTraceEnd(trace: Trace): Promise<void>;
    /**
     * Called when a span is started
     */
    onSpanStart(span: Span): Promise<void>;
    /**
     * Called when a span is ended
     */
    onSpanEnd(span: Span): Promise<void>;
    /**
     * Called when the trace processor is shutting down
     */
    shutdown(timeout?: number): Promise<void>;
    /**
     * Called when a trace is being flushed
     */
    forceFlush(): Promise<void>;
}
/**
 * Exports traces and spans. For example, could log them or send them to a backend.
 */
export interface TracingExporter {
    /**
     * Export the given traces and spans
     * @param items - The traces and spans to export
     */
    export(items: (Trace | Span)[], signal?: AbortSignal): Promise<void>;
}
/**
 * Prints the traces and spans to the console
 */
export declare class ConsoleSpanExporter implements TracingExporter {
    export(items: (Trace | Span)[]): Promise<void>;
}
export type BatchTraceProcessorOptions = {
    /**
     * The maximum number of spans to store in the queue. After this, we will start dropping spans.
     */
    maxQueueSize?: number;
    /**
     * The maximum number of spans to export in a single batch.
     */
    maxBatchSize?: number;
    /**
     * The delay between checks for new spans to export in milliseconds.
     */
    scheduleDelay?: number;
    /**
     * The ratio of the queue size at which we will trigger an export.
     */
    exportTriggerRatio?: number;
};
export declare class BatchTraceProcessor implements TracingProcessor {
    #private;
    constructor(exporter: TracingExporter, { maxQueueSize, maxBatchSize, scheduleDelay, // 5 seconds
    exportTriggerRatio, }?: BatchTraceProcessorOptions);
    start(): void;
    onTraceStart(trace: Trace): Promise<void>;
    onTraceEnd(_trace: Trace): Promise<void>;
    onSpanStart(_span: Span): Promise<void>;
    onSpanEnd(span: Span): Promise<void>;
    shutdown(timeout?: number): Promise<void>;
    forceFlush(): Promise<void>;
}
export declare class MultiTracingProcessor implements TracingProcessor {
    #private;
    start(): void;
    addTraceProcessor(processor: TracingProcessor): void;
    setProcessors(processors: TracingProcessor[]): void;
    onTraceStart(trace: Trace): Promise<void>;
    onTraceEnd(trace: Trace): Promise<void>;
    onSpanStart(span: Span): Promise<void>;
    onSpanEnd(span: Span): Promise<void>;
    shutdown(timeout?: number): Promise<void>;
    forceFlush(): Promise<void>;
}
export declare function defaultExporter(): TracingExporter;
export declare function defaultProcessor(): TracingProcessor;
export {};
