import { TracingProcessor } from './processor';
import { Span, SpanData, SpanOptions } from './spans';
import { Trace, TraceOptions } from './traces';
export type CreateSpanOptions<TData extends SpanData> = Omit<SpanOptions<TData>, 'traceId'> & {
    traceId?: string;
    disabled?: boolean;
};
export declare class TraceProvider {
    #private;
    constructor();
    /**
     * Add a processor to the list of processors. Each processor will receive all traces/spans.
     *
     * @param processor - The processor to add.
     */
    registerProcessor(processor: TracingProcessor): void;
    /**
     * Set the list of processors. This will replace any existing processors.
     *
     * @param processors - The list of processors to set.
     */
    setProcessors(processors: TracingProcessor[]): void;
    /**
     * Get the current trace.
     *
     * @returns The current trace.
     */
    getCurrentTrace(): Trace | null;
    getCurrentSpan(): Span<any> | null;
    setDisabled(disabled: boolean): void;
    startExportLoop(): void;
    createTrace(traceOptions: TraceOptions): Trace;
    createSpan<TSpanData extends SpanData>(spanOptions: CreateSpanOptions<TSpanData>, parent?: Span<any> | Trace): Span<TSpanData>;
    shutdown(timeout?: number): Promise<void>;
    forceFlush(): Promise<void>;
}
export declare function getGlobalTraceProvider(): TraceProvider;
