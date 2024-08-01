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

type Money = {
  currency: string;
  amount: number;
};

export interface GuardrailResult {
  status: "processed" | "skipped" | "error";
  passed: boolean;
  score?: number | null;
  details?: string | null;
  cost?: Money | null;
}

interface TypedValueGuardrailResult {
  type: "guardrail_result";
  value: GuardrailResult;
}

export type SpanInputOutput =
  | TypedValueText
  | TypedValueChatMessages
  | TypedValueGuardrailResult
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

interface SpanMetrics {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  tokens_estimated?: boolean | null;
  cost?: number | null;
}

interface SpanParams {
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
  tool_choice?: string | null;
  parallel_tool_calls?: boolean | null;
  functions?: Record<string, any>[] | null;
  user?: string | null;
}

interface SpanTimestamps {
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
  | "workflow"
  | "component"
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
}

export interface LLMSpan extends BaseSpan {
  type: "llm";
  // TODO: deprecate field, standardize on litellm model names
  vendor?: string | null;
  model?: string;
  params?: SpanParams;
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
  | Omit<LLMSpan, "input" | "output">
  | Omit<RAGSpan, "input" | "output">
  | Omit<BaseSpan, "input" | "output">
) & {
  input?: SpanInputOutputValidator | null;
  output?: SpanInputOutputValidator | null;
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
  embeddings?: { model: string; embeddings: number[] };
  satisfaction_score?: number;
};

export type TraceOutput = {
  value: string;
  embeddings?: { model: string; embeddings: number[] };
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
  metrics: {
    first_token_ms?: number | null;
    total_time_ms?: number | null;
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_cost?: number | null;
    tokens_estimated?: boolean | null;
  };
  error?: ErrorCapture | null;
  indexing_md5s?: string[];
};

export type ElasticSearchTrace = Omit<Trace, "metadata" | "timestamps"> & {
  metadata: ReservedTraceMetadata & {
    custom?: CustomMetadata;
    all_keys?: string[];
  };
  timestamps: Trace["timestamps"] & {
    updated_at: number;
  };

  spans?: ElasticSearchSpan[];
  evaluations?: TraceCheck[];
  events?: ElasticSearchEvent[];
};

export type TraceCheck = {
  trace_id: string;
  check_id: string;
  project_id: string;
  check_type: string;
  check_name: string;
  is_guardrail: boolean;
  status: "scheduled" | "in_progress" | "error" | "skipped" | "processed";
  passed?: boolean;
  score?: number;
  details?: string;
  error?: ErrorCapture | null;
  retries?: number;
  timestamps: {
    inserted_at?: number;
    started_at?: number;
    finished_at?: number;
    updated_at: number;
  };
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
  | Omit<BaseSpan, "project_id" | "trace_id" | "id" | "timestamps" | "metrics">
  | Omit<LLMSpan, "project_id" | "trace_id" | "id" | "timestamps" | "metrics">
  | Omit<RAGSpan, "project_id" | "trace_id" | "id" | "timestamps" | "metrics">;
