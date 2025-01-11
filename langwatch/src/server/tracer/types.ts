type ChatRole =
  | "system"
  | "user"
  | "assistant"
  | "function"
  | "tool"
  | "unknown";

interface FunctionCall {
  name?: string;
  arguments?: string;
}

interface ToolCall {
  id: string;
  type: string;
  function: FunctionCall;
}

export type Contexts = {
  traceId: string;
  contexts: RAGChunk[];
};

export interface ChatMessage {
  role?: ChatRole;
  content?: string | ChatRichContent[] | null;
  function_call?: FunctionCall | null;
  tool_calls?: ToolCall[] | null;
  tool_call_id?: string | null;
  name?: string | null;
}

export type ChatRichContent =
  | {
      type: "text";
      text?: string;
    }
  | {
      type: "image_url";
      image_url?: {
        url: string;
        detail?: "auto" | "low" | "high";
      };
    }
  | {
      type: "tool_call";
      toolName?: string;
      toolCallId?: string;
      args?: string;
    }
  | {
      type: "tool_result";
      toolName?: string;
      toolCallId?: string;
      result?: any;
    };

export interface TypedValueChatMessages {
  type: "chat_messages";
  value: ChatMessage[];
}

interface TypedValueText {
  type: "text";
  value: string;
}

interface TypedValueRaw {
  type: "raw";
  value: string;
}

type JSONSerializable =
  | string
  | number
  | boolean
  | null
  | Record<string, any>
  | any[];

export interface TypedValueJson {
  type: "json";
  value: JSONSerializable;
}

export type Money = {
  currency: string;
  amount: number;
};

export interface EvaluationResult {
  status: "processed" | "skipped" | "error";
  passed?: boolean | null;
  score?: number | null;
  label?: string | null;
  details?: string | null;
  cost?: Money | null;
}

export interface TypedValueGuardrailResult {
  type: "guardrail_result";
  value: EvaluationResult;
}

export interface TypedValueEvaluationResult {
  type: "evaluation_result";
  value: EvaluationResult;
}

export type SpanInputOutput =
  | TypedValueText
  | TypedValueChatMessages
  | TypedValueGuardrailResult
  | TypedValueEvaluationResult
  | TypedValueJson
  | TypedValueRaw
  | {
      type: "list";
      value: SpanInputOutput[];
    };

export interface ErrorCapture {
  has_error: true;
  message: string;
  stacktrace: string[];
}

export interface SpanMetrics {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  tokens_estimated?: boolean | null;
  cost?: number | null;
}

export type ReservedSpanParams = {
  frequency_penalty?: number | null;
  logit_bias?: Record<string, number> | null;
  logprobs?: boolean | null;
  top_logprobs?: number | null;
  max_tokens?: number | null;
  n?: number | null;
  presence_penalty?: number | null;
  seed?: number | null;
  stop?: string | string[] | null;
  stream?: boolean | null;
  temperature?: number | null;
  top_p?: number | null;
  tools?: Record<string, any>[] | null;
  tool_choice?: Record<string, any> | string | null;
  parallel_tool_calls?: boolean | null;
  functions?: Record<string, any>[] | null;
  user?: string | null;
};

export type SpanParams = ReservedSpanParams & Record<string, any>;

export interface SpanTimestamps {
  started_at: number;
  first_token_at?: number | null;
  finished_at: number;
}

export type SpanTypes =
  | "span"
  | "llm"
  | "chain"
  | "tool"
  | "agent"
  | "rag"
  | "guardrail"
  | "evaluation"
  // Low-code
  | "workflow"
  | "component"
  // DSPy
  | "module"
  // OpenTelemetry
  | "server"
  | "client"
  | "producer"
  | "consumer"
  // Other
  | "task" // openllmetry
  | "unknown";

export interface BaseSpan {
  span_id: string;
  parent_id?: string | null;
  trace_id: string;
  type: SpanTypes;
  name?: string | null;
  input?: SpanInputOutput | null;
  output?: SpanInputOutput | null;
  error?: ErrorCapture | null;
  timestamps: SpanTimestamps;
  metrics?: SpanMetrics | null;
  params?: SpanParams | null;
}

export interface LLMSpan extends BaseSpan {
  type: "llm";
  // TODO: deprecate field, standardize on litellm model names
  vendor?: string | null;
  model?: string | null;
}

export interface RAGChunk {
  document_id?: string | null;
  chunk_id?: string | null;
  content: string | Record<string, any> | any[];
}

export interface RAGSpan extends BaseSpan {
  type: "rag";
  contexts: RAGChunk[];
}

export type Span = LLMSpan | RAGSpan | BaseSpan;

type SpanInputOutputValidator = SpanInputOutput & { value: any };

export type SpanValidator = (
  | Omit<LLMSpan, "input" | "output" | "params">
  | Omit<RAGSpan, "input" | "output" | "params">
  | Omit<BaseSpan, "input" | "output" | "params">
) & {
  input?: SpanInputOutputValidator | null;
  output?: SpanInputOutputValidator | null;
  params?: Record<string, any> | null;
};

export type ElasticSearchInputOutput = {
  type: SpanInputOutput["type"];
  value: string;
};

// Zod type will not be generated for this one, check ts-to-zod.config.js
export type ElasticSearchSpan = Omit<
  BaseSpan & Partial<Omit<RAGSpan, "type">> & Partial<Omit<LLMSpan, "type">>,
  "input" | "output"
> & {
  project_id: string;
  input?: ElasticSearchInputOutput | null;
  output?: ElasticSearchInputOutput | null;
  timestamps: SpanTimestamps & { inserted_at: number; updated_at: number };
};

export type TraceInput = {
  value: string;
  satisfaction_score?: number;
};

export type TraceOutput = {
  value: string;
};

type PrimitiveType = string | number | boolean | null | undefined;

export type ReservedTraceMetadata = {
  thread_id?: string | null;
  user_id?: string | null;
  customer_id?: string | null;
  labels?: string[] | null;
  topic_id?: string | null;
  subtopic_id?: string | null;
  sdk_version?: string | null;
  sdk_language?: string | null;
};

export type CustomMetadata = Record<
  string,
  | PrimitiveType
  | PrimitiveType[]
  | Record<string, PrimitiveType>
  | Record<string, Record<string, PrimitiveType>>
>;

export type TraceMetadata = ReservedTraceMetadata & CustomMetadata;

export type Trace = {
  trace_id: string;
  project_id: string;
  metadata: TraceMetadata;
  timestamps: { started_at: number; inserted_at: number; updated_at: number };
  input?: TraceInput;
  output?: TraceOutput;
  contexts?: RAGChunk[];
  expected_output?: { value: string };
  metrics?: {
    first_token_ms?: number | null;
    total_time_ms?: number | null;
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_cost?: number | null;
    tokens_estimated?: boolean | null;
  };
  error?: ErrorCapture | null;
  indexing_md5s?: string[];

  events?: Event[];
  evaluations?: Evaluation[];
  // TODO: add spans here too
};

// TODO: kill this after previous todo is done
export type TraceWithSpans = Trace & { spans: Span[] };

export type ElasticSearchTrace = Omit<
  Trace,
  "metadata" | "timestamps" | "events"
> & {
  metadata: ReservedTraceMetadata & {
    custom?: CustomMetadata;
    all_keys?: string[];
  };
  timestamps: Trace["timestamps"] & {
    updated_at: number;
  };

  spans?: ElasticSearchSpan[];
  evaluations?: ElasticSearchEvaluation[];
  events?: ElasticSearchEvent[];
};

type EvaluationStatus =
  | "scheduled"
  | "in_progress"
  | "error"
  | "skipped"
  | "processed";

export type Evaluation = {
  evaluation_id: string;
  evaluator_id: string;
  span_id?: string | null;
  name: string;
  type?: string | null;
  is_guardrail?: boolean | null;
  status: EvaluationStatus;
  passed?: boolean | null;
  score?: number | null;
  label?: string | null;
  details?: string | null;
  error?: ErrorCapture | null;
  retries?: number | null;
  timestamps: {
    inserted_at?: number | null;
    started_at?: number | null;
    finished_at?: number | null;
    updated_at?: number | null;
  };
};

export type ElasticSearchEvaluation = Evaluation;

export type RESTEvaluation = Omit<
  Evaluation,
  "evaluation_id" | "evaluator_id" | "status" | "timestamps" | "retries"
> & {
  evaluation_id?: string | null;
  evaluator_id?: string | null;
  status?: "processed" | "skipped" | "error" | null;
  timestamps?: {
    started_at?: number | null;
    finished_at?: number | null;
  } | null;
};

export type CollectorRESTParams = {
  trace_id?: string | null | undefined;
  spans: Span[];
  metadata?: {
    user_id?: string | null | undefined;
    thread_id?: string | null | undefined;
    customer_id?: string | null | undefined;
    labels?: string[] | null | undefined;
    sdk_version?: string | null | undefined;
    sdk_language?: string | null | undefined;
  } & CustomMetadata;
  expected_output?: string | null;
  evaluations?: RESTEvaluation[];
};

export type CollectorRESTParamsValidator = Omit<CollectorRESTParams, "spans">;

export type Event = {
  event_id: string;
  event_type: string; // Type of event (e.g., 'thumbs_up_down', 'add_to_cart')
  project_id: string;
  metrics: Record<string, number>;
  event_details: Record<string, string>;

  trace_id: string;
  timestamps: { started_at: number; inserted_at: number; updated_at: number };
};

export type ElasticSearchEvent = Omit<Event, "metrics" | "event_details"> & {
  metrics: { key: string; value: number }[];
  event_details: { key: string; value: string }[];
};

export type TrackEventRESTParamsValidator = Omit<
  Event,
  "event_id" | "project_id" | "timestamps" | "event_details"
> & {
  event_id?: string; // auto generated unless you want to guarantee idempotency
  event_details?: Record<string, string>;
  timestamp?: number; // The timestamp when the event occurred
};

// Dataset Schemas

export type DatasetSpan =
  | (Omit<
      BaseSpan,
      "project_id" | "trace_id" | "id" | "timestamps" | "metrics" | "params"
    > & { params: Record<string, any> })
  | (Omit<
      LLMSpan,
      "project_id" | "trace_id" | "id" | "timestamps" | "metrics" | "params"
    > & { params: Record<string, any> })
  | (Omit<
      RAGSpan,
      "project_id" | "trace_id" | "id" | "timestamps" | "metrics" | "params"
    > & { params: Record<string, any> });
