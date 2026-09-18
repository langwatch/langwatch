import { DeepPartial } from '../types';
import { CreateSpanOptions } from './provider';
import { Span, ResponseSpanData, SpanData, AgentSpanData, FunctionSpanData, HandoffSpanData, GenerationSpanData, CustomSpanData, GuardrailSpanData, TranscriptionSpanData, SpeechSpanData, SpeechGroupSpanData, MCPListToolsSpanData } from './spans';
import { Trace } from './traces';
type CreateArgs<TData extends SpanData> = DeepPartial<CreateSpanOptions<TData>>;
/**
 * Create a new response span. The span will not be started automatically, you should either
 * use `withResponseSpan()` or call `span.start()` and `span.end()` manually.
 *
 * This span captures the details of a model response, primarily the response identifier.
 * If you need to capture detailed generation information such as input/output messages,
 * model configuration, or usage data, use `createGenerationSpan()` instead.
 *
 * @param options - Optional span creation options, including span data and identifiers.
 * @param parent - The parent span or trace. If not provided, the current trace/span will be used
 * automatically.
 *
 * @returns The newly created response span.
 */
export declare function createResponseSpan(options?: CreateArgs<ResponseSpanData>, parent?: Span<any> | Trace): Span<ResponseSpanData>;
/**
 * Create a new response span and automatically start and end it.
 *
 * This span captures the details of a model response, primarily the response identifier.
 * If you need to capture detailed generation information such as input/output messages,
 * model configuration, or usage data, use `generationSpan()` instead.
 */
export declare const withResponseSpan: <TOutput>(fn: (span: Span<ResponseSpanData>) => Promise<TOutput>, options?: DeepPartial<CreateSpanOptions<ResponseSpanData>> | undefined, parent?: Span<any> | Trace | undefined) => Promise<TOutput>;
/**
 * Create a new agent span. The span will not be started automatically, you should either
 * use `withAgentSpan()` or call `span.start()` and `span.end()` manually.
 *
 * @param options - Optional span creation options, including span data and identifiers.
 * @param parent - The parent span or trace. If not provided, the current trace/span will be used
 * automatically.
 *
 * @returns The newly created agent span.
 */
export declare function createAgentSpan(options?: CreateArgs<AgentSpanData>, parent?: Span<any> | Trace): Span<AgentSpanData>;
/**
 * Create a new agent span and automatically start and end it.
 */
export declare const withAgentSpan: <TOutput>(fn: (span: Span<AgentSpanData>) => Promise<TOutput>, options?: DeepPartial<CreateSpanOptions<AgentSpanData>> | undefined, parent?: Span<any> | Trace | undefined) => Promise<TOutput>;
/**
 * Create a new function span. The span will not be started automatically, you should either
 * use `withFunctionSpan()` or call `span.start()` and `span.end()` manually.
 *
 * @param options - Optional span creation options, including span data and identifiers.
 * @param parent - The parent span or trace. If not provided, the current trace/span will be used
 * automatically.
 *
 * @returns The newly created function span.
 */
export declare function createFunctionSpan(options: CreateArgs<FunctionSpanData> & {
    data: {
        name: string;
    };
}, parent?: Span<any> | Trace): Span<FunctionSpanData>;
/**
 * Create a new function span and automatically start and end it.
 */
export declare const withFunctionSpan: <TOutput>(fn: (span: Span<FunctionSpanData>) => Promise<TOutput>, options: DeepPartial<CreateSpanOptions<FunctionSpanData>> & {
    data: {
        name: string;
    };
}, parent?: Span<any> | Trace | undefined) => Promise<TOutput>;
/**
 * Create a new handoff span. The span will not be started automatically, you should either
 * use `withHandoffSpan()` or call `span.start()` and `span.end()` manually.
 *
 * @param options - Optional span creation options, including span data and identifiers.
 * @param parent - The parent span or trace. If not provided, the current trace/span will be used
 * automatically.
 *
 * @returns The newly created handoff span.
 */
export declare function createHandoffSpan(options?: CreateArgs<HandoffSpanData>, parent?: Span<any> | Trace): Span<HandoffSpanData>;
/**
 * Create a new handoff span and automatically start and end it.
 */
export declare const withHandoffSpan: <TOutput>(fn: (span: Span<HandoffSpanData>) => Promise<TOutput>, options?: DeepPartial<CreateSpanOptions<HandoffSpanData>> | undefined, parent?: Span<any> | Trace | undefined) => Promise<TOutput>;
/**
 * Create a new generation span. The span will not be started automatically, you should either
 * use `withGenerationSpan()` or call `span.start()` and `span.end()` manually.
 *
 * This span captures the details of a model generation, including input/output message
 * sequences, model information, and usage data. If you only need to capture a model response
 * identifier, consider using `createResponseSpan()` instead.
 */
export declare function createGenerationSpan(options?: CreateArgs<GenerationSpanData>, parent?: Span<any> | Trace): Span<GenerationSpanData>;
/** Automatically create a generation span, run fn and close the span */
export declare const withGenerationSpan: <TOutput>(fn: (span: Span<GenerationSpanData>) => Promise<TOutput>, options?: DeepPartial<CreateSpanOptions<GenerationSpanData>> | undefined, parent?: Span<any> | Trace | undefined) => Promise<TOutput>;
/**
 * Create a new custom span. The span will not be started automatically, you should either use
 * `withCustomSpan()` or call `span.start()` and `span.end()` manually.
 */
export declare function createCustomSpan(options: CreateArgs<CustomSpanData> & {
    data: {
        name: string;
    };
}, parent?: Span<any> | Trace): Span<CustomSpanData>;
export declare const withCustomSpan: <TOutput>(fn: (span: Span<CustomSpanData>) => Promise<TOutput>, options: DeepPartial<CreateSpanOptions<CustomSpanData>> & {
    data: {
        name: string;
    };
}, parent?: Span<any> | Trace | undefined) => Promise<TOutput>;
/**
 * Create a new guardrail span. The span will not be started automatically, you should either use
 * `withGuardrailSpan()` or call `span.start()` and `span.end()` manually.
 */
export declare function createGuardrailSpan(options: CreateArgs<GuardrailSpanData> & {
    data: {
        name: string;
    };
}, parent?: Span<any> | Trace): Span<GuardrailSpanData>;
export declare const withGuardrailSpan: <TOutput>(fn: (span: Span<GuardrailSpanData>) => Promise<TOutput>, options: DeepPartial<CreateSpanOptions<GuardrailSpanData>> & {
    data: {
        name: string;
    };
}, parent?: Span<any> | Trace | undefined) => Promise<TOutput>;
/**
 * Create a new transcription span. The span will not be started automatically.
 */
export declare function createTranscriptionSpan(options: CreateArgs<TranscriptionSpanData> & {
    data: {
        input: {
            data: string;
            format: 'pcm' | (string & {});
        };
    };
}, parent?: Span<any> | Trace): Span<TranscriptionSpanData>;
export declare const withTranscriptionSpan: <TOutput>(fn: (span: Span<TranscriptionSpanData>) => Promise<TOutput>, options: DeepPartial<CreateSpanOptions<TranscriptionSpanData>> & {
    data: {
        input: {
            data: string;
            format: "pcm" | (string & {});
        };
    };
}, parent?: Span<any> | Trace | undefined) => Promise<TOutput>;
/**
 * Create a new speech span. The span will not be started automatically.
 */
export declare function createSpeechSpan(options: CreateArgs<SpeechSpanData> & {
    data: {
        output: {
            data: string;
            format: 'pcm' | (string & {});
        };
    };
}, parent?: Span<any> | Trace): Span<SpeechSpanData>;
export declare const withSpeechSpan: <TOutput>(fn: (span: Span<SpeechSpanData>) => Promise<TOutput>, options: DeepPartial<CreateSpanOptions<SpeechSpanData>> & {
    data: {
        output: {
            data: string;
            format: "pcm" | (string & {});
        };
    };
}, parent?: Span<any> | Trace | undefined) => Promise<TOutput>;
/**
 * Create a new speech group span. The span will not be started automatically.
 */
export declare function createSpeechGroupSpan(options?: CreateArgs<SpeechGroupSpanData>, parent?: Span<any> | Trace): Span<SpeechGroupSpanData>;
export declare const withSpeechGroupSpan: <TOutput>(fn: (span: Span<SpeechGroupSpanData>) => Promise<TOutput>, options?: DeepPartial<CreateSpanOptions<SpeechGroupSpanData>> | undefined, parent?: Span<any> | Trace | undefined) => Promise<TOutput>;
/**
 * Create a new MCP list tools span. The span will not be started automatically.
 */
export declare function createMCPListToolsSpan(options?: CreateArgs<MCPListToolsSpanData>, parent?: Span<any> | Trace): Span<MCPListToolsSpanData>;
export declare const withMCPListToolsSpan: <TOutput>(fn: (span: Span<MCPListToolsSpanData>) => Promise<TOutput>, options?: DeepPartial<CreateSpanOptions<MCPListToolsSpanData>> | undefined, parent?: Span<any> | Trace | undefined) => Promise<TOutput>;
export {};
