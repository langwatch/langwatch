import { TracingExporter } from '@openai/agents-core';
import type { Span } from '@openai/agents-core/dist/tracing/spans';
import type { Trace } from '@openai/agents-core/dist/tracing/traces';
/**
 * Options for OpenAITracingExporter.
 */
export type OpenAITracingExporterOptions = {
    apiKey?: string;
    organization: string;
    project: string;
    endpoint: string;
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
};
/**
 * A tracing exporter that exports traces to OpenAI's tracing API.
 */
export declare class OpenAITracingExporter implements TracingExporter {
    #private;
    constructor(options?: Partial<OpenAITracingExporterOptions>);
    export(items: (Trace | Span<any>)[], signal?: AbortSignal): Promise<void>;
}
/**
 * Sets the OpenAI Tracing exporter as the default exporter with a BatchTraceProcessor handling the
 * traces
 */
export declare function setDefaultOpenAITracingExporter(): void;
