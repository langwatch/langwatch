type ChatRole = "system" | "user" | "assistant" | "unknown";

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

type SpanInput =
  | TypedValueText
  | TypedValueChatMessages
  | TypedValueJson
  | TypedValueRaw;
type SpanOutput =
  | TypedValueText
  | TypedValueChatMessages
  | TypedValueJson
  | TypedValueRaw;

interface ErrorCapture {
  message: string;
  stacktrace: string[];
}

interface SpanMetrics {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
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
  span_id: string;
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

// Zod type will not be generated for this one, check ts-to-zod.config.js
export type ElasticSearchSpan = BaseSpan &
  Partial<Omit<LLMSpan, "type">> & { project_id: string };
