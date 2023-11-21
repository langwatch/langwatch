type ChatRole = "system" | "user" | "assistant" | "function" | "unknown";

interface FunctionCall {
  name?: string;
  arguments?: string;
}

interface ChatMessage {
  role?: ChatRole;
  content?: string | null;
  function_call?: FunctionCall;
}

interface TypedValueChatMessages {
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

interface TypedValueJson {
  type: "json";
  value: JSONSerializable;
}

export type SpanInput =
  | TypedValueText
  | TypedValueChatMessages
  | TypedValueJson
  | TypedValueRaw;
export type SpanOutput =
  | TypedValueText
  | TypedValueChatMessages
  | TypedValueJson
  | TypedValueRaw;

export interface ErrorCapture {
  message: string;
  stacktrace: string[];
}

interface SpanMetrics {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  tokens_estimated?: boolean | null;
}

interface SpanParams {
  temperature: number;
  stream: boolean;
  functions?: Record<string, any>[];
}

interface SpanTimestamps {
  started_at: number;
  first_token_at?: number | null;
  finished_at: number;
}

type SpanTypes = "span" | "llm" | "chain" | "tool" | "agent";

export interface BaseSpan {
  type: SpanTypes;
  name?: string | null;
  id: string;
  parent_id?: string | null;
  trace_id: string;
  input?: SpanInput | null;
  outputs: SpanOutput[];
  error?: ErrorCapture | null;
  timestamps: SpanTimestamps;
}

export interface LLMSpan extends BaseSpan {
  type: "llm";
  vendor: string;
  model: string;
  raw_response?: string | Record<string, any> | any[];
  params: SpanParams;
  metrics: SpanMetrics;
}

export type Span = LLMSpan | BaseSpan;

type SpanInputValidator = SpanInput & { value: any };
type SpanOutputValidator = SpanInput & { value: any };

export type SpanValidator = (
  | Omit<LLMSpan, "input" | "outputs">
  | Omit<BaseSpan, "input" | "outputs">
) & {
  input: SpanInputValidator;
  outputs: SpanOutputValidator[];
};

export type ElasticSearchInputOutput = {
  type: SpanInput["type"];
  value: string;
};

// Zod type will not be generated for this one, check ts-to-zod.config.js
export type ElasticSearchSpan = Omit<
  BaseSpan & Partial<Omit<LLMSpan, "type" | "raw_response">>,
  "input" | "outputs"
> & {
  project_id: string;
  input?: ElasticSearchInputOutput | null;
  outputs: ElasticSearchInputOutput[];
  raw_response?: string | null;
};

export type TraceInputOutput = { value: string; openai_embeddings?: number[] };

export type Trace = {
  id: string;
  project_id: string;
  thread_id?: string;
  user_id?: string;
  timestamps: { started_at: number; inserted_at: number };
  input: TraceInputOutput;
  output?: TraceInputOutput;
  metrics: {
    first_token_ms?: number | null;
    total_time_ms?: number | null;
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_cost?: number | null;
    tokens_estimated?: boolean | null;
  };
  error?: ErrorCapture | null;
  search_embeddings: {
    openai_embeddings?: number[];
  };
};

export type TraceCheck = {
  id: string;
  trace_id: string;
  project_id: string;
  check_type: string;
  status: "scheduled" | "in_progress" | "failed" | "succeeded";
  raw_result?: object;
  value?: number;
  error?: ErrorCapture | null;
  retries?: number;
  timestamps: {
    inserted_at?: number;
    started_at?: number;
    finished_at?: number;
  };
};
