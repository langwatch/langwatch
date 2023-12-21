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

interface ChatMessage {
  role?: ChatRole;
  content?: string | null;
  function_call?: FunctionCall | null;
  tool_calls?: ToolCall[] | null;
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
  cost?: number | null;
}

interface SpanParams {
  temperature?: number;
  stream?: boolean;
  functions?: Record<string, any>[];
  tools?: Record<string, any>[];
  tool_choice?: string;
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
  // Grouping Fields
  thread_id?: string;
  user_id?: string;
  customer_id?: string;
  labels?: string[];
  // End Grouping Fields
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
  topics?: string[];
};

export type TraceCheck = {
  id: string;
  trace_id: string;
  project_id: string;
  // Grouping Fields
  thread_id?: string;
  user_id?: string;
  customer_id?: string;
  labels?: string[];
  // End Grouping Fields
  check_id: string;
  check_type: string;
  check_name: string;
  status: "scheduled" | "in_progress" | "error" | "failed" | "succeeded";
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

export type Experiment = {
  id: string;
  variant: number;
};

export type CollectorRESTParams = {
  trace_id: string;
  spans: Span[];
  user_id?: string | null | undefined;
  thread_id?: string | null | undefined;
  customer_id?: string | null | undefined;
  labels?: string[] | null | undefined;
  experiments?: Experiment[] | null | undefined;
};

export type CollectorRESTParamsValidator = Omit<CollectorRESTParams, "spans">;
