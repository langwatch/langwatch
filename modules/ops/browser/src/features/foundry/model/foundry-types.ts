let _idCounter = 0;
export function shortId(): string {
  return (++_idCounter).toString(36) + Math.random().toString(36).slice(2, 7);
}

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

export const INPUT_OUTPUT_TYPES = ["text", "raw", "chat_messages", "json", "list"] as const;

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

export interface SpanEvent {
  name: string;
  attributes: Record<string, unknown>;
  offsetMs?: number;
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
  /**
   * Runtime prompt reference — what actually ran. Either a bare handle
   * ("customer-support") or `handle:version_or_tag` shorthand. Bare
   * handles are auto-combined with `version` / `versionId` at emit time.
   */
  promptId?: string;
  /** Numeric version. Combined into `langwatch.prompt.id` when promptId is bare. */
  version?: number;
  /** Database id of the version row — emitted as `langwatch.prompt.version.id`. */
  versionId?: string;
  /**
   * The pin the developer set on the call site, in shorthand form
   * ("handle:production"), emitted as `langwatch.prompt.selected.id`. When
   * this differs from the resolved runtime prompt, the drawer warns of drift.
   */
  selectedId?: string;
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

  events?: SpanEvent[];

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
  llm: "blue.fg",
  agent: "purple.fg",
  tool: "green.fg",
  rag: "teal.fg",
  chain: "orange.fg",
  prompt: "yellow.fg",
  guardrail: "red.fg",
  evaluation: "pink.fg",
  workflow: "blue.fg",
  component: "cyan.fg",
  module: "cyan.fg",
  span: "gray.fg",
  server: "gray.fg",
  client: "gray.fg",
  producer: "gray.fg",
  consumer: "gray.fg",
  task: "gray.fg",
  unknown: "gray.fg",
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
