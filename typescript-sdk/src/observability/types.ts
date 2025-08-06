import {
  AttributeValue,
  Context,
  Span,
  SpanOptions,
  Tracer,
} from "@opentelemetry/api";
import * as langwatchAttributes from "./semconv/attributes";
import * as semconvAttributes from "@opentelemetry/semantic-conventions/incubating";
import * as intSemconv from "./semconv";

// Utility type to pull out all values of keys on an object, and only allow types which
// are strings, while preserving the auto-completion of the keys.
type OnlyStringValues<T> = {
  [K in keyof T]: T[K] extends string ? T[K] : never;
}[keyof T];

/**
 * Union type representing all possible attribute keys that can be used in spans.
 *
 * This includes:
 * - Standard OpenTelemetry semantic convention attributes
 * - LangWatch-specific attributes
 * - Custom string attributes
 *
 * @example
 * ```typescript
 * const attributes: SemconvAttributes = {
 *   "http.method": "GET",
 *   "http.url": "https://api.example.com",
 *   "langwatch.span.type": "llm",
 *   "custom.attribute": "value"
 * };
 * ```
 */
export type AttributeKey =
  | OnlyStringValues<typeof semconvAttributes>
  | OnlyStringValues<typeof langwatchAttributes>
  | (string & {});

/**
 * Record type representing span attributes with semantic convention keys.
 *
 * This type ensures type safety when setting attributes on spans while
 * allowing both standard OpenTelemetry semantic conventions and custom attributes.
 *
 * @example
 * ```typescript
 * const spanAttributes: SemconvAttributes = {
 *   "service.name": "my-service",
 *   "service.version": "1.0.0",
 *   "langwatch.span.type": "llm",
 *   "custom.user.id": "user123"
 * };
 * ```
 */
export type SemconvAttributes = Partial<Record<AttributeKey, AttributeValue>>;

export interface LangWatchSpanOptions extends SpanOptions {
  attributes?: SemconvAttributes;
}

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
 * Body for a system message event in a GenAI span.
 *
 * Used to log system/instruction messages sent to the model.
 *
 * @property content - The message content.
 * @property role - The role of the message, typically 'system' or 'instruction'.
 *
 * @example
 * span.addGenAISystemMessageEvent({ content: 'You are a helpful assistant.' });
 */
export interface LangWatchSpanGenAISystemMessageEventBody {
  /** Content of the system message */
  content?: string;
  /** Role of the message (system or instruction) */
  role?: "system" | "instruction";
}

/**
 * Body for a user message event in a GenAI span.
 *
 * Used to log user/customer messages sent to the model.
 *
 * @property content - The message content.
 * @property role - The role of the message, typically 'user' or 'customer'.
 *
 * @example
 * span.addGenAIUserMessageEvent({ content: 'What is the weather today?' });
 */
export interface LangWatchSpanGenAIUserMessageEventBody {
  /** Content of the user message */
  content?: string;
  /** Role of the message (user or customer) */
  role?: "user" | "customer";
}

/**
 * Body for an assistant message event in a GenAI span.
 *
 * Used to log assistant/bot responses, including tool calls.
 *
 * @property content - The message content.
 * @property role - The role of the message, typically 'assistant' or 'bot'.
 * @property tool_calls - Array of tool call objects, if the assistant invoked tools/functions.
 *
 * @example
 * span.addGenAIAssistantMessageEvent({ content: 'The weather is sunny.', role: 'assistant' });
 */
export interface LangWatchSpanGenAIAssistantMessageEventBody {
  /** Content of the assistant message */
  content?: string;
  /** Role of the message (assistant or bot) */
  role?: "assistant" | "bot";
  /** Tool calls made by the assistant */
  tool_calls?: {
    function: {
      /** Name of the function called */
      name: string;
      /** Arguments passed to the function */
      arguments?: string;
    };
    /** Tool call identifier */
    id: string;
    /** Type of tool call */
    type: "function";
  }[];
}

/**
 * Body for a tool message event in a GenAI span.
 *
 * Used to log messages from tools/functions invoked by the assistant.
 *
 * @property content - The message content.
 * @property id - Unique identifier for the tool call.
 * @property role - The role, typically 'tool' or 'function'.
 *
 * @example
 * span.addGenAIToolMessageEvent({ content: 'Result from tool', id: 'tool-1', role: 'tool' });
 */
export interface LangWatchSpanGenAIToolMessageEventBody {
  /** Content of the tool message */
  content?: string;
  /** Tool call identifier */
  id: string;
  /** Role of the message (tool or function) */
  role?: "tool" | "function";
}

/**
 * Body for a choice event in a GenAI span.
 *
 * Used to log the model's output choices, including finish reason and message content.
 *
 * @property finish_reason - Why the generation finished (e.g., 'stop', 'length').
 * @property index - Index of the choice (for multi-choice outputs).
 * @property message - The message content and tool calls for this choice.
 *
 * @example
 * span.addGenAIChoiceEvent({ finish_reason: 'stop', index: 0, message: { content: 'Hello!' } });
 */
export interface LangWatchSpanGenAIChoiceEventBody {
  /** Reason the generation finished */
  finish_reason: intSemconv.VAL_GEN_AI_FINISH_REASONS | (string & {});
  /** Index of the choice */
  index: number;
  /** Message content for the choice */
  message?: {
    /** Content of the message */
    content?: string;
    /** Role of the message (assistant or bot) */
    role?: "assistant" | "bot";
    /** Tool calls made by the assistant */
    tool_calls?: {
      function: {
        /** Name of the function called */
        name: string;
        /** Arguments passed to the function */
        arguments?: string;
      };
      /** Tool call identifier */
      id: string;
      /** Type of tool call */
      type: "function";
    }[];
  };
}

/**
 * Enhanced LangWatch tracer interface that extends OpenTelemetry's Tracer.
 *
 * This tracer provides additional functionality beyond the standard OpenTelemetry tracer:
 * - Returns LangWatchSpan instances instead of standard OpenTelemetry Spans
 * - Includes a custom `withActiveSpan` method for simplified span lifecycle management
 * - Automatic error handling and span status management in `withActiveSpan`
 * - Enhanced type safety with strongly-typed callback functions
 *
 * @example Basic usage
 * ```typescript
 * const tracer = getLangWatchTracer('my-service', '1.0.0');
 *
 * // Create and manage spans manually
 * const span = tracer.startSpan('operation');
 * span.setAttributes({ key: 'value' });
 * span.end();
 *
 * // Use active span with automatic lifecycle management
 * const result = await tracer.startActiveSpan('async-operation', async (span) => {
 *   span.setAttributes({ userId: '123' });
 *   return await someAsyncWork();
 * });
 *
 * // Use withActiveSpan for automatic error handling and span cleanup
 * const result = await tracer.withActiveSpan('safe-operation', async (span) => {
 *   // Span is automatically ended and errors are properly recorded
 *   return await riskyOperation();
 * });
 * ```
 */
export interface LangWatchTracer extends Tracer {
  /**
   * Starts a new LangWatchSpan without setting it as the active span.
   *
   * **Enhanced from OpenTelemetry**: Returns a LangWatchSpan instead of a standard Span,
   * providing additional LangWatch-specific functionality like structured input/output
   * recording and enhanced attribute management.
   *
   * @param name - The name of the span
   * @param options - Optional span configuration options
   * @param context - Optional context to use for extracting parent span information
   * @returns A new LangWatchSpan instance
   *
   * @example
   * ```typescript
   * const span = tracer.startSpan('database-query');
   * span.setAttributes({
   *   'db.statement': 'SELECT * FROM users',
   *   'db.operation': 'select'
   * });
   *
   * try {
   *   const result = await database.query('SELECT * FROM users');
   *   span.setStatus({ code: SpanStatusCode.OK });
   *   return result;
   * } catch (error) {
   *   span.setStatus({
   *     code: SpanStatusCode.ERROR,
   *     message: error.message
   *   });
   *   span.recordException(error);
   *   throw error;
   * } finally {
   *   span.end();
   * }
   * ```
   */
  startSpan(
    name: string,
    options?: LangWatchSpanOptions,
    context?: Context,
  ): LangWatchSpan;

  /**
   * Starts a new active LangWatchSpan and executes the provided function within its context.
   *
   * **Same as OpenTelemetry** but with LangWatchSpan: The span is automatically set as active
   * in the current context for the duration of the function execution. The span must be
   * manually ended within the callback function.
   *
   * @param name - The name of the span
   * @param fn - Function to execute with the active span
   * @returns The return value of the provided function
   *
   * @example
   * ```typescript
   * const result = tracer.startActiveSpan('user-operation', (span) => {
   *   span.setAttributes({ userId: '123' });
   *
   *   try {
   *     const userData = fetchUserData();
   *     span.setStatus({ code: SpanStatusCode.OK });
   *     return userData;
   *   } catch (error) {
   *     span.setStatus({
   *       code: SpanStatusCode.ERROR,
   *       message: error.message
   *     });
   *     throw error;
   *   } finally {
   *     span.end(); // Must manually end the span
   *   }
   * });
   * ```
   */
  startActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    fn: F,
  ): ReturnType<F>;

  /**
   * Starts a new active LangWatchSpan with options and executes the provided function.
   *
   * @param name - The name of the span
   * @param options - Span configuration options
   * @param fn - Function to execute with the active span
   * @returns The return value of the provided function
   */
  startActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    options: LangWatchSpanOptions,
    fn: F,
  ): ReturnType<F>;

  /**
   * Starts a new active LangWatchSpan with options and context, then executes the function.
   *
   * @param name - The name of the span
   * @param options - Span configuration options
   * @param context - Context to use for extracting parent span information
   * @param fn - Function to execute with the active span
   * @returns The return value of the provided function
   */
  startActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    options: LangWatchSpanOptions,
    context: Context,
    fn: F,
  ): ReturnType<F>;

  /**
   * **LangWatch Enhancement**: Creates and manages a span with **automatic lifecycle and error handling**.
   *
   * 🚀 **Automatic span management, batteries included**:
   * - ✅ **Span automatically ends** when your function completes (success or failure)
   * - ✅ **Errors automatically handled** - exceptions are caught, recorded, and span marked as ERROR
   * - ✅ **No need to call `span.end()`** - completely managed for you
   * - ✅ **No try/catch needed** - error recording is automatic
   *
   * **Key differences from OpenTelemetry's startActiveSpan**:
   * - Automatically ends the span when the function completes
   * - Automatically sets span status to ERROR and records exceptions on thrown errors
   * - Handles both synchronous and asynchronous functions seamlessly
   * - Provides a safer, more convenient API for span management
   *
   * **Perfect for**: Operations where you want zero boilerplate span management.
   * Just focus on your business logic - span lifecycle is handled automatically.
   *
   * @param name - The name of the span
   * @param fn - Function to execute with the managed span (can be sync or async)
   * @returns A promise that resolves to the return value of the provided function
   *
   * @example ✅ Clean code - NO manual span management needed
   * ```typescript
   * // ✅ AUTOMATIC span ending and error handling
   * const result = await tracer.withActiveSpan('risky-operation', async (span) => {
   *   span.setAttributes({ operation: 'data-processing' });
   *
   *   if (Math.random() > 0.5) {
   *     throw new Error('Random failure'); // ✅ Automatically recorded, span marked as ERROR
   *   }
   *
   *   return 'success';
   *   // ✅ NO span.end() needed - automatically handled!
   *   // ✅ NO try/catch needed - errors automatically recorded!
   * });
   * ```
   *
   * @example ❌ vs ✅ Compare with manual span management
   * ```typescript
   * // ❌ Manual span management (what you DON'T need to do)
   * const span = tracer.startSpan('operation');
   * try {
   *   span.setAttributes({ key: 'value' });
   *   const result = await doWork();
   *   span.setStatus({ code: SpanStatusCode.OK });
   *   return result;
   * } catch (error) {
   *   span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
   *   span.recordException(error);
   *   throw error;
   * } finally {
   *   span.end(); // Must remember to end!
   * }
   *
   * // ✅ With withActiveSpan (clean and automatic)
   * const result = await tracer.withActiveSpan('operation', async (span) => {
   *   span.setAttributes({ key: 'value' });
   *   return await doWork(); // That's it! Everything else is automatic
   * });
   * ```
   *
   * @example ✅ Synchronous operations (no async/await needed)
   * ```typescript
   * const result = await tracer.withActiveSpan('sync-calc', (span) => {
   *   span.setAttributes({ calculation: 'fibonacci' });
   *   return fibonacci(10); // ✅ Synchronous function - span ends automatically
   * });
   *
   * // ✅ Even with operations that might throw
   * const data = await tracer.withActiveSpan('read-config', (span) => {
   *   span.setAttributes({ file: 'config.json' });
   *   return JSON.parse(fs.readFileSync('config.json', 'utf8')); // ✅ Errors auto-handled
   * });
   * ```
   */
  withActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    fn: F,
  ): ReturnType<F>;

  /**
   * Creates and manages a span with options and automatic lifecycle management.
   *
   * @param name - The name of the span
   * @param options - Span configuration options
   * @param fn - Function to execute with the managed span (can be sync or async)
   * @returns A promise that resolves to the return value of the provided function
   */
  withActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    options: LangWatchSpanOptions,
    fn: F,
  ): ReturnType<F>;

  /**
   * Creates and manages a span with options, context, and automatic lifecycle management.
   *
   * @param name - The name of the span
   * @param options - Span configuration options
   * @param context - Context to use for extracting parent span information
   * @param fn - Function to execute with the managed span (can be sync or async)
   * @returns A promise that resolves to the return value of the provided function
   */
  withActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    options: LangWatchSpanOptions,
    context: Context,
    fn: F,
  ): ReturnType<F>;
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
   * Add a GenAI system message event to the span.
   *
   * This logs a system/instruction message sent to the model.
   *
   * @param body - The event body (content and role)
   * @param system - The GenAI system (optional, e.g., 'openai', 'anthropic')
   * @param attributes - Additional OpenTelemetry attributes (optional)
   * @returns this
   */
  addGenAISystemMessageEvent(
    body: LangWatchSpanGenAISystemMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: Record<string, AttributeValue>,
  ): this;
  /**
   * Add a GenAI user message event to the span.
   *
   * This logs a user/customer message sent to the model.
   *
   * @param body - The event body (content and role)
   * @param system - The GenAI system (optional)
   * @param attributes - Additional OpenTelemetry attributes (optional)
   * @returns this
   */
  addGenAIUserMessageEvent(
    body: LangWatchSpanGenAIUserMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: Record<string, AttributeValue>,
  ): this;
  /**
   * Add a GenAI assistant message event to the span.
   *
   * This logs an assistant/bot response, including tool calls if present.
   *
   * @param body - The event body (content, role, tool_calls)
   * @param system - The GenAI system (optional)
   * @param attributes - Additional OpenTelemetry attributes (optional)
   * @returns this
   */
  addGenAIAssistantMessageEvent(
    body: LangWatchSpanGenAIAssistantMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: Record<string, AttributeValue>,
  ): this;
  /**
   * Add a GenAI tool message event to the span.
   *
   * This logs a message from a tool/function invoked by the assistant.
   *
   * @param body - The event body (content, id, role)
   * @param system - The GenAI system (optional)
   * @param attributes - Additional OpenTelemetry attributes (optional)
   * @returns this
   */
  addGenAIToolMessageEvent(
    body: LangWatchSpanGenAIToolMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: Record<string, AttributeValue>,
  ): this;
  /**
   * Add a GenAI choice event to the span.
   *
   * This logs a model output choice, including finish reason and message content.
   *
   * @param body - The event body (finish_reason, index, message)
   * @param system - The GenAI system (optional)
   * @param attributes - Additional OpenTelemetry attributes (optional)
   * @returns this
   */
  addGenAIChoiceEvent(
    body: LangWatchSpanGenAIChoiceEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: Record<string, AttributeValue>,
  ): this;

  /**
   * Set multiple attributes for the span.
   *
   * @param attributes - The attributes object
   * @returns this
   */
  setAttributes(attributes: SemconvAttributes): this;

  /**
   * Set a single attribute for the span.
   *
   * @param key - The attribute key
   * @param value - The attribute value
   * @returns this
   */
  setAttribute(key: keyof SemconvAttributes, value: AttributeValue): this;

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

  // /**
  //  * Set the selected prompt for the span. This will attach this prompt to the trace. If
  //  * this is set on multiple spans, the last one will be used.
  //  *
  //  * @param prompt - The prompt object
  //  * @returns this
  //  */
  // setSelectedPrompt(prompt: Prompt): this;

  /**
   * Record the input to the span as a JSON-serializable value.
   *
   * The input is stringified and stored as a span attribute for later analysis.
   *
   * @param input - The input value (any type, will be JSON.stringified)
   * @returns this
   */
  setInput(input: unknown): this;
  /**
   * Record the input to the span as a plain string.
   *
   * Use this for raw text prompts or queries.
   *
   * @param input - The input string
   * @returns this
   */
  setInputString(input: string): this;
  /**
   * Record the output from the span as a JSON-serializable value.
   *
   * The output is stringified and stored as a span attribute for later analysis.
   *
   * @param output - The output value (any type, will be JSON.stringified)
   * @returns this
   */
  setOutput(output: unknown): this;
  /**
   * Record the output from the span as a plain string.
   *
   * Use this for raw text completions or responses.
   *
   * @param output - The output string
   * @returns this
   */
  setOutputString(output: string): this;

  // /**
  //  * Set the evaluation output for the span.
  //  *
  //  * @param guardrail - Whether the evaluation is a guardrail
  //  * @param output - The evaluation result
  //  * @returns this
  //  */
  // setOutputEvaluation(guardrail: boolean, output: EvaluationResultModel): this;
}
