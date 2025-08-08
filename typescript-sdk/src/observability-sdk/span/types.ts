import {
  type AttributeValue,
  type Span,
  type SpanOptions,
} from "@opentelemetry/api";
import {
  type SpanInputOutput,
  type ChatMessage,
} from "../../internal/generated/types/tracer";
import { type Prompt } from "@/client-sdk/services/prompts";

export type JsonSerializable =
  | string
  | number
  | boolean
  | null
  | JsonSerializable[]
  | { [key: string]: JsonSerializable };

// Import attributes types from parent
import type { SemConvAttributes } from "../semconv";

/**
 * Supported types of spans for LangWatch observability. These types categorize the nature of the span for downstream analysis and visualization.
 *
 * @example
 * import { spanTypes, SpanType } from './span';
 * const myType: SpanType = 'llm';
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
 * Context for a RAG (Retrieval-Augmented Generation) span.
 *
 * This structure is used to record which document and chunk were retrieved and used as context for a generation.
 *
 * @property document_id - Unique identifier for the source document.
 * @property chunk_id - Unique identifier for the chunk within the document.
 * @property content - The actual content of the chunk provided to the model.
 *
 * @example
 * const ragContext: LangWatchSpanRAGContext = {
 *   document_id: 'doc-123',
 *   chunk_id: 'chunk-456',
 *   content: 'Relevant passage from the document.'
 * };
 */
export interface LangWatchSpanRAGContext {
  document_id: string;
  chunk_id: string;
  content: string;
}

/**
 * Metrics for a LangWatch span.
 *
 * @property promptTokens - The number of prompt tokens used.
 * @property completionTokens - The number of completion tokens used.
 * @property cost - The cost of the span.
 */
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
 * Extension of OpenTelemetry's Span with LangWatch-specific helpers for LLM, RAG, and GenAI tracing.
 *
 * This interface provides ergonomic methods for recording structured LLM/GenAI data, such as inputs, outputs, RAG contexts, and message events.
 *
 * All methods return `this` for chaining.
 *
 * @example
 * const span = createLangWatchSpan(otelSpan);
 * span
 *   .setType('llm')
 *   .setInput({ prompt: 'Hello' })
 *   .setOutput('Hi!')
 *   .addGenAIUserMessageEvent({ content: 'Hello' })
 *   .addGenAIAssistantMessageEvent({ content: 'Hi!' });
 */
export interface LangWatchSpan extends Span {
  // /**
  //  * Record the evaluation result for the span.
  //  *
  //  * @param details - The evaluation details
  //  * @param attributes - Additional attributes to add to the evaluation span.
  //  * @returns this
  //  */
  // recordEvaluation(
  //   details: RecordedEvaluationDetails,
  //   attributes?: Attributes,
  // ): this;

  /**
   * Set multiple attributes for the span.
   *
   * @param attributes - The attributes object
   * @returns this
   */
  setAttributes(attributes: SemConvAttributes): this;

  /**
   * Set a single attribute for the span.
   *
   * @param key - The attribute key
   * @param value - The attribute value
   * @returns this
   */
  setAttribute(key: keyof SemConvAttributes, value: AttributeValue): this;

  /**
   * Set the type of the span (e.g., 'llm', 'rag', 'tool', etc).
   *
   * This is used for downstream filtering and analytics.
   *
   * @param type - The span type (see SpanType)
   * @returns this
   */
  setType(type: SpanType): this;

  /**
   * Set the request model name for the span.
   *
   * This is typically the model name sent in the API request (e.g., 'gpt-4', 'claude-3').
   *
   * @param model - The request model name
   * @returns this
   */
  setRequestModel(model: string): this;
  /**
   * Set the response model name for the span.
   *
   * This is the model name returned in the API response, if different from the request.
   *
   * @param model - The response model name
   * @returns this
   */
  setResponseModel(model: string): this;

  /**
   * Set multiple RAG contexts for the span.
   *
   * Use this to record all retrieved documents/chunks used as context for a generation.
   *
   * @param ragContexts - Array of RAG context objects
   * @returns this
   */
  setRAGContexts(ragContexts: LangWatchSpanRAGContext[]): this;
  /**
   * Set a single RAG context for the span.
   *
   * Use this if only one context was retrieved.
   *
   * @param ragContext - The RAG context object
   * @returns this
   */
  setRAGContext(ragContext: LangWatchSpanRAGContext): this;

  /**
   * Set the metrics for the span.
   *
   * @param metrics - The metrics object
   * @returns this
   */
  setMetrics(metrics: LangWatchSpanMetrics): this;

  /**
   * Set the selected prompt for the span. This will attach this prompt to the trace. If
   * this is set on multiple spans, the last one will be used.
   *
   * @param prompt - The prompt object
   * @returns this
   */
  setSelectedPrompt(prompt: Prompt): this;

  /**
   * Record the input to the span with explicit type control.
   *
   * @param type - Force as "text" type
   * @param input - String input value
   * @returns this
   */
  setInput(type: "text", input: string): this;
  /**
   * Record the input to the span with explicit type control.
   *
   * @param type - Force as "raw" type
   * @param input - Any input value
   * @returns this
   */
  setInput(type: "raw", input: unknown): this;
  /**
   * Record the input to the span with explicit type control.
   *
   * @param type - Force as "chat_messages" type
   * @param input - Chat messages array
   * @returns this
   */
  setInput(type: "chat_messages", input: ChatMessage[]): this;
  /**
   * Record the input to the span with explicit type control.
   *
   * @param type - Force as "list" type
   * @param input - SpanInputOutput array
   * @returns this
   */
  setInput(type: "list", input: SpanInputOutput[]): this;
  /**
   * Record the input to the span with explicit type control.
   *
   * @param type - Force as "json" type
   * @param input - Any JSON-serializable value
   * @returns this
   */
  setInput(type: "json", input: JsonSerializable): this;
  /**
   * Record the input to the span with automatic type detection.
   *
   * Automatically detects: strings → text, ChatMessage[] → chat_messages,
   * arrays → list, objects → json.
   *
   * @param input - The input value (auto-detected type)
   * @returns this
   */
  setInput(input: unknown): this;

  /**
   * Record the output from the span with explicit type control.
   *
   * @param type - Force as "text" type
   * @param output - String output value
   * @returns this
   */
  setOutput(type: "text", output: string): this;
  /**
   * Record the output from the span with explicit type control.
   *
   * @param type - Force as "raw" type
   * @param output - Any output value
   * @returns this
   */
  setOutput(type: "raw", output: unknown): this;
  /**
   * Record the output from the span with explicit type control.
   *
   * @param type - Force as "chat_messages" type
   * @param output - Chat messages array
   * @returns this
   */
  setOutput(type: "chat_messages", output: ChatMessage[]): this;
  /**
   * Record the output from the span with explicit type control.
   *
   * @param type - Force as "list" type
   * @param output - SpanInputOutput array
   * @returns this
   */
  setOutput(type: "list", output: SpanInputOutput[]): this;
  /**
   * Record the output from the span with explicit type control.
   *
   * @param type - Force as "json" type
   * @param output - Any JSON-serializable value
   * @returns this
   */
  setOutput(type: "json", output: JsonSerializable): this;
  /**
   * Record the output from the span with automatic type detection.
   *
   * Automatically detects: strings → text, ChatMessage[] → chat_messages,
   * arrays → list, objects → json.
   *
   * @param output - The output value (auto-detected type)
   * @returns this
   */
  setOutput(output: unknown): this;

  // /**
  //  * Set the evaluation output for the span.
  //  *
  //  * @param guardrail - Whether the evaluation is a guardrail
  //  * @param output - The evaluation result
  //  * @returns this
  //  */
  // setOutputEvaluation(guardrail: boolean, output: EvaluationResultModel): this;
}
