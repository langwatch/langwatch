export const SPAN_TYPES = [
  "span",
  "llm",
  "chain",
  "tool",
  "agent",
  "guardrail",
  "evaluation",
  "rag",
  "prompt",
  "workflow",
  "component",
  "module",
  "server",
  "client",
  "producer",
  "consumer",
  "task",
  "unknown",
] as const;

export type SpanType = (typeof SPAN_TYPES)[number];

export const INPUT_OUTPUT_TYPES = [
  "text",
  "raw",
  "chat_messages",
  "json",
  "list",
] as const;

export type InputOutputType = (typeof INPUT_OUTPUT_TYPES)[number];

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface SpanInputOutput {
  type: InputOutputType;
  value: unknown;
}

export interface SpanMetrics {
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
}

export interface RAGContext {
  document_id: string;
  chunk_id: string;
  content: string;
}

export interface SpanException {
  message: string;
  stackTrace?: string;
}

export interface LLMConfig {
  requestModel?: string;
  responseModel?: string;
  messages?: ChatMessage[];
  temperature?: number;
  stream?: boolean;
  metrics?: SpanMetrics;
}

export interface RAGConfig {
  contexts: RAGContext[];
}

export interface PromptConfig {
  promptId?: string;
  versionId?: string;
  variables?: Record<string, string>;
}

export interface SpanConfig {
  id: string;
  name: string;
  type: SpanType;
  durationMs: number;
  offsetMs: number;
  status: "ok" | "error" | "unset";
  children: SpanConfig[];

  input?: SpanInputOutput;
  output?: SpanInputOutput;
  attributes: Record<string, string | number | boolean>;
  exception?: SpanException;

  llm?: LLMConfig;
  rag?: RAGConfig;
  prompt?: PromptConfig;
}

export interface TraceMetadata {
  userId?: string;
  threadId?: string;
  customerId?: string;
  labels?: string[];
}

export interface TraceConfig {
  id: string;
  name: string;
  description?: string;
  resourceAttributes: Record<string, string>;
  metadata: TraceMetadata;
  spans: SpanConfig[];
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  config: TraceConfig;
}

export const SPAN_TYPE_COLORS: Record<SpanType, string> = {
  llm: "blue.400",
  agent: "purple.400",
  tool: "green.400",
  rag: "teal.400",
  chain: "orange.500",
  prompt: "yellow.400",
  guardrail: "red.400",
  evaluation: "pink.400",
  workflow: "blue.300",
  component: "cyan.400",
  module: "cyan.400",
  span: "gray.400",
  server: "gray.400",
  client: "gray.400",
  producer: "gray.400",
  consumer: "gray.400",
  task: "gray.400",
  unknown: "gray.500",
};

export const SPAN_TYPE_ICONS: Record<SpanType, string> = {
  llm: "🤖",
  agent: "🧠",
  tool: "🔧",
  rag: "📚",
  chain: "🔗",
  prompt: "📝",
  guardrail: "🛡️",
  evaluation: "📊",
  workflow: "⚡",
  component: "🧩",
  module: "📦",
  span: "─",
  server: "🖥️",
  client: "💻",
  producer: "📤",
  consumer: "📥",
  task: "📋",
  unknown: "❓",
};
