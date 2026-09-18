import { TracingProcessor } from './processor';
type SpanDataBase = {
    type: string;
};
export type AgentSpanData = SpanDataBase & {
    type: 'agent';
    name: string;
    handoffs?: string[];
    tools?: string[];
    output_type?: string;
};
export type FunctionSpanData = SpanDataBase & {
    type: 'function';
    name: string;
    input: string;
    output: string;
    mcp_data?: string;
};
export type GenerationSpanData = SpanDataBase & {
    type: 'generation';
    input?: Array<Record<string, any>>;
    output?: Array<Record<string, any>>;
    model?: string;
    model_config?: Record<string, any>;
    usage?: Record<string, any>;
};
export type ResponseSpanData = SpanDataBase & {
    type: 'response';
    response_id?: string;
    /**
     * Not used by the OpenAI tracing provider but helpful for other tracing providers.
     */
    _input?: string | Record<string, any>[];
    _response?: Record<string, any>;
};
export type HandoffSpanData = SpanDataBase & {
    type: 'handoff';
    from_agent?: string;
    to_agent?: string;
};
export type CustomSpanData = SpanDataBase & {
    type: 'custom';
    name: string;
    data: Record<string, any>;
};
export type GuardrailSpanData = SpanDataBase & {
    type: 'guardrail';
    name: string;
    triggered: boolean;
};
export type TranscriptionSpanData = SpanDataBase & {
    type: 'transcription';
    input: {
        data: string;
        format: 'pcm' | (string & {});
    };
    output?: string;
    model?: string;
    model_config?: Record<string, any>;
};
export type SpeechSpanData = SpanDataBase & {
    type: 'speech';
    input?: string;
    output: {
        data: string;
        format: 'pcm' | (string & {});
    };
    model?: string;
    model_config?: Record<string, any>;
};
export type SpeechGroupSpanData = SpanDataBase & {
    type: 'speech_group';
    input?: string;
};
export type MCPListToolsSpanData = SpanDataBase & {
    type: 'mcp_tools';
    server?: string;
    result?: string[];
};
export type SpanData = AgentSpanData | FunctionSpanData | GenerationSpanData | ResponseSpanData | HandoffSpanData | CustomSpanData | GuardrailSpanData | TranscriptionSpanData | SpeechSpanData | SpeechGroupSpanData | MCPListToolsSpanData;
export type SpanOptions<TData extends SpanData> = {
    traceId: string;
    spanId?: string;
    parentId?: string;
    data: TData;
    startedAt?: string;
    endedAt?: string;
    error?: SpanError;
    tracingApiKey?: string;
};
export type SpanError = {
    message: string;
    data?: Record<string, any>;
};
export declare class Span<TData extends SpanData> {
    #private;
    type: "trace.span";
    constructor(options: SpanOptions<TData>, processor: TracingProcessor);
    get traceId(): string;
    get spanData(): TData;
    get spanId(): string;
    get parentId(): string | null;
    get previousSpan(): Span<any> | undefined;
    set previousSpan(span: Span<any> | undefined);
    start(): void;
    end(): void;
    setError(error: SpanError): void;
    get error(): SpanError | null;
    get startedAt(): string | null;
    get endedAt(): string | null;
    get tracingApiKey(): string | undefined;
    clone(): Span<TData>;
    toJSON(): object | null;
}
export declare class NoopSpan<TSpanData extends SpanData> extends Span<TSpanData> {
    constructor(data: TSpanData, processor: TracingProcessor);
    start(): void;
    end(): void;
    setError(): void;
    toJSON(): null;
}
export {};
