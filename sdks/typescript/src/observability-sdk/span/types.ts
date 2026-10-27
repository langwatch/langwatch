import { type AttributeValue, type Span, type SpanOptions } from "@opentelemetry/api";

import { type Prompt } from "@/client-sdk/services/prompts";

import { type SpanInputOutput, type ChatMessage } from "../../internal/generated/types/tracer";
import { type AddEvaluationParams } from "../evaluation";

/**
 * Simple chat message type with just role and content
 */
export interface SimpleChatMessage {
  role: string;
  content: unknown;
}

/**
 * Valid input/output types for span data
 */
export const INPUT_OUTPUT_TYPES = [
  "text",
  "raw",
  "chat_messages",
  "list",
  "json",
  "guardrail_result",
  "evaluation_result",
] as const;

export type InputOutputType = (typeof INPUT_OUTPUT_TYPES)[number];

export type JsonSerializable =
  | string
  | number
  | boolean
  | null
  | JsonSerializable[]
  | Record<string, any>;

// Import attributes types from parent
import type { SemConvAttributes } from "../semconv";

/**
 * Supported types of spans for LangWatch observability, categorizing a span's
 * nature for downstream analysis and visualization.
 */
export const spanTypes = [
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

export type SpanType = (typeof spanTypes)[number];

/**
 * Context for a RAG (Retrieval-Augmented Generation) span: which document and
 * chunk were retrieved and used to generate a response.
 */
export interface LangWatchSpanRAGContext {
  document_id: string;
  chunk_id: string;
  content: string;
}

/** Metrics for a LangWatch span. */
export interface LangWatchSpanMetrics {
  /** The number of prompt tokens used */
  promptTokens?: number;
  /** The number of completion tokens used */
  completionTokens?: number;
  /** The cost of the span */
  cost?: number;
}

/**
 * Options for creating a LangWatch span.
 *
 * @param attributes - Additional attributes to add to the span.
 */
export interface LangWatchSpanOptions extends SpanOptions {
  /** Additional attributes to add to the span. */
  attributes?: SemConvAttributes;
}

/**
 * Extension of OpenTelemetry's Span with LangWatch-specific helpers for LLM, RAG, and
 * GenAI tracing. All methods return `this` for chaining.
 */
export interface LangWatchSpan extends Span {
  /**
   * Records a `langwatch.evaluation.custom` event, matching the Python SDK's `add_evaluation`.
   * @param params - Evaluation params; only `name` is required. {@link AddEvaluationParams}
   * @returns this
   */
  addEvaluation(params: AddEvaluationParams): this;

  /**
   * @deprecated Use {@link LangWatchSpan.addEvaluation} instead. Alias kept for
   * backward compatibility with earlier documentation.
   *
   * @param params - The evaluation parameters. See {@link AddEvaluationParams}.
   * @returns this
   */
  recordEvaluation(params: AddEvaluationParams): this;

  /**
   * @param attributes - The attributes object
   * @returns this
   */
  setAttributes(attributes: SemConvAttributes): this;

  /**
   * @param key - The attribute key
   * @param value - The attribute value
   * @returns this
   */
  setAttribute(key: keyof SemConvAttributes, value: AttributeValue): this;

  /**
   * Sets the span type (e.g. 'llm', 'rag', 'tool') for downstream filtering and analytics.
   * @param type - The span type (see SpanType)
   * @returns this
   */
  setType(type: SpanType): this;

  /**
   * The model sent in the API request (e.g. 'gpt-4'), as opposed to the response model.
   * @param model - The request model name
   * @returns this
   */
  setRequestModel(model: string): this;
  /**
   * The model name returned in the API response, if different from the request model.
   * @param model - The response model name
   * @returns this
   */
  setResponseModel(model: string): this;

  /**
   * Records all retrieved documents/chunks used as context for a generation.
   * @param ragContexts - Array of RAG context objects
   * @returns this
   */
  setRAGContexts(ragContexts: LangWatchSpanRAGContext[]): this;
  /**
   * Use when only a single RAG context was retrieved.
   * @param ragContext - The RAG context object
   * @returns this
   */
  setRAGContext(ragContext: LangWatchSpanRAGContext): this;

  /**
   * @param metrics - The metrics object
   * @returns this
   */
  setMetrics(metrics: LangWatchSpanMetrics): this;

  /**
   * Attaches this prompt to the trace; if set on multiple spans, the last one wins.
   * @param prompt - The prompt object
   * @returns this
   */
  setSelectedPrompt(prompt: Prompt): this;

  /**
   * @param type - Force as "text" type
   * @param input - String input value
   * @returns this
   */
  setInput(type: "text", input: string): this;
  /**
   * @param type - Force as "raw" type
   * @param input - Any input value
   * @returns this
   */
  setInput(type: "raw", input: unknown): this;
  /**
   * @param type - Force as "chat_messages" type
   * @param input - Chat messages array (supports both ChatMessage[] and SimpleChatMessage[])
   * @returns this
   */
  setInput(type: "chat_messages", input: ChatMessage[] | SimpleChatMessage[]): this;
  /**
   * @param type - Force as "list" type
   * @param input - SpanInputOutput array
   * @returns this
   */
  setInput(type: "list", input: SpanInputOutput[]): this;
  /**
   * @param type - Force as "json" type
   * @param input - Any JSON-serializable value
   * @returns this
   */
  setInput(type: "json", input: unknown): this;
  /**
   * @param type - Force as "guardrail_result" type
   * @param input - Guardrail result value
   * @returns this
   */
  setInput(type: "guardrail_result", input: unknown): this;
  /**
   * @param type - Force as "evaluation_result" type
   * @param input - Evaluation result value
   * @returns this
   */
  setInput(type: "evaluation_result", input: unknown): this;
  /**
   * Auto-detects type: string→text, ChatMessage[]→chat_messages, array→list, object→json.
   * @param input - The input value (auto-detected type)
   * @returns this
   */
  setInput(input: unknown): this;

  /**
   * @param type - Force as "text" type
   * @param output - String output value
   * @returns this
   */
  setOutput(type: "text", output: string): this;
  /**
   * @param type - Force as "raw" type
   * @param output - Any output value
   * @returns this
   */
  setOutput(type: "raw", output: unknown): this;
  /**
   * @param type - Force as "chat_messages" type
   * @param output - Chat messages array (supports both ChatMessage[] and SimpleChatMessage[])
   * @returns this
   */
  setOutput(type: "chat_messages", output: ChatMessage[] | SimpleChatMessage[]): this;
  /**
   * @param type - Force as "list" type
   * @param output - SpanInputOutput array
   * @returns this
   */
  setOutput(type: "list", output: SpanInputOutput[]): this;
  /**
   * @param type - Force as "json" type
   * @param output - Any JSON-serializable value
   * @returns this
   */
  setOutput(type: "json", output: unknown): this;
  /**
   * @param type - Force as "guardrail_result" type
   * @param output - Guardrail result value
   * @returns this
   */
  setOutput(type: "guardrail_result", output: unknown): this;
  /**
   * @param type - Force as "evaluation_result" type
   * @param output - Evaluation result value
   * @returns this
   */
  setOutput(type: "evaluation_result", output: unknown): this;
  /**
   * Auto-detects type: string→text, ChatMessage[]→chat_messages, array→list, object→json.
   * @param output - The output value (auto-detected type)
   * @returns this
   */
  setOutput(output: unknown): this;
}
