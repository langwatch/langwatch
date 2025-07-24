import { AttributeValue, Span } from "@opentelemetry/api";
import semconv from "@opentelemetry/semantic-conventions/build/esm/experimental_attributes";
import * as intSemconv from "./semconv";

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
 *   .recordInput({ prompt: 'Hello' })
 *   .recordOutput('Hi!')
 *   .addGenAIUserMessageEvent({ content: 'Hello' })
 *   .addGenAIAssistantMessageEvent({ content: 'Hi!' });
 */
export interface LangWatchSpan extends Span {
  /**
   * Record the input to the span as a JSON-serializable value.
   *
   * The input is stringified and stored as a span attribute for later analysis.
   *
   * @param input - The input value (any type, will be JSON.stringified)
   * @returns this
   */
  recordInput(input: unknown): this;
  /**
   * Record the input to the span as a plain string.
   *
   * Use this for raw text prompts or queries.
   *
   * @param input - The input string
   * @returns this
   */
  recordInputString(input: string): this;
  /**
   * Record the output from the span as a JSON-serializable value.
   *
   * The output is stringified and stored as a span attribute for later analysis.
   *
   * @param output - The output value (any type, will be JSON.stringified)
   * @returns this
   */
  recordOutput(output: unknown): this;
  /**
   * Record the output from the span as a plain string.
   *
   * Use this for raw text completions or responses.
   *
   * @param output - The output string
   * @returns this
   */
  recordOutputString(output: string): this;

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
}

/**
 * Wraps an OpenTelemetry Span with LangWatch-specific helpers for LLM, RAG, and GenAI tracing.
 *
 * This function returns a Proxy that adds ergonomic methods for recording LLM/GenAI data to the span.
 *
 * @param span - The OpenTelemetry Span to wrap
 * @returns A LangWatchSpan proxy with additional methods for LLM/GenAI observability
 *
 * @example
 * import { createLangWatchSpan } from './span';
 * const otelSpan = tracer.startSpan('llm-call');
 * const span = createLangWatchSpan(otelSpan);
 * span.setType('llm').recordInput('Prompt').recordOutput('Completion');
 */
export function createLangWatchSpan(span: Span): LangWatchSpan {
  const langwatchSpanMethods = {
    recordInput(input: unknown) {
      span.setAttribute(
        intSemconv.ATTR_LANGWATCH_INPUT,
        JSON.stringify({
          type: "json",
          value: JSON.stringify(input),
        }),
      );
    },
    recordInputString(input: string) {
      span.setAttribute(
        intSemconv.ATTR_LANGWATCH_INPUT,
        JSON.stringify({
          type: "text",
          value: input,
        }),
      );
    },
    recordOutput(output: unknown) {
      span.setAttribute(
        intSemconv.ATTR_LANGWATCH_OUTPUT,
        JSON.stringify({
          type: "json",
          value: JSON.stringify(output),
        }),
      );
    },
    recordOutputString(output: string) {
      span.setAttribute(
        intSemconv.ATTR_LANGWATCH_OUTPUT,
        JSON.stringify({
          type: "text",
          value: output,
        }),
      );
    },

    addGenAISystemMessageEvent(
      body: LangWatchSpanGenAISystemMessageEventBody,
      system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
      attributes?: Record<string, AttributeValue>,
    ) {
      if (body.role === void 0) {
        body.role = "system";
      }

      span.addEvent(intSemconv.LOG_EVNT_GEN_AI_SYSTEM_MESSAGE, {
        ...attributes,
        [semconv.ATTR_GEN_AI_SYSTEM]: system,
        [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_BODY]: JSON.stringify(body),
        [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_IMPOSTER]: true,
      });
    },
    addGenAIUserMessageEvent(
      body: LangWatchSpanGenAIUserMessageEventBody,
      system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
      attributes?: Record<string, AttributeValue>,
    ) {
      if (body.role === void 0) {
        body.role = "user";
      }

      span.addEvent(intSemconv.LOG_EVNT_GEN_AI_USER_MESSAGE, {
        ...attributes,
        [semconv.ATTR_GEN_AI_SYSTEM]: system,
        [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_BODY]: JSON.stringify(body),
        [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_IMPOSTER]: true,
      });
    },
    addGenAIAssistantMessageEvent(
      body: LangWatchSpanGenAIAssistantMessageEventBody,
      system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
      attributes?: Record<string, AttributeValue>,
    ) {
      if (body.role === void 0) {
        body.role = "assistant";
      }

      span.addEvent(intSemconv.LOG_EVNT_GEN_AI_ASSISTANT_MESSAGE, {
        ...attributes,
        [semconv.ATTR_GEN_AI_SYSTEM]: system,
        [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_BODY]: JSON.stringify(body),
        [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_IMPOSTER]: true,
      });
    },
    addGenAIToolMessageEvent(
      body: LangWatchSpanGenAIToolMessageEventBody,
      system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
      attributes?: Record<string, AttributeValue>,
    ) {
      if (body.role === void 0) {
        body.role = "tool";
      }

      span.addEvent(intSemconv.LOG_EVNT_GEN_AI_TOOL_MESSAGE, {
        ...attributes,
        [semconv.ATTR_GEN_AI_SYSTEM]: system,
        [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_BODY]: JSON.stringify(body),
        [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_IMPOSTER]: true,
      });
    },
    addGenAIChoiceEvent(
      body: LangWatchSpanGenAIChoiceEventBody,
      system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
      attributes?: Record<string, AttributeValue>,
    ) {
      if (body.message && body.message.role === void 0) {
        body.message.role = "assistant";
      }

      span.addEvent(intSemconv.LOG_EVNT_GEN_AI_CHOICE, {
        ...attributes,
        [semconv.ATTR_GEN_AI_SYSTEM]: system,
        [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_BODY]: JSON.stringify(body),
        [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_IMPOSTER]: true,
      });
    },

    setType(type: SpanType) {
      span.setAttribute(intSemconv.ATTR_LANGWATCH_SPAN_TYPE, type);
    },

    setRequestModel(model: string) {
      span.setAttribute(semconv.ATTR_GEN_AI_REQUEST_MODEL, model);
    },
    setResponseModel(model: string) {
      span.setAttribute(semconv.ATTR_GEN_AI_RESPONSE_MODEL, model);
    },

    setRAGContexts(ragContexts: LangWatchSpanRAGContext[]) {
      span.setAttribute(
        intSemconv.ATTR_LANGWATCH_RAG_CONTEXTS,
        JSON.stringify({
          type: "json",
          value: JSON.stringify(ragContexts),
        }),
      );
    },
    setRAGContext(ragContext: LangWatchSpanRAGContext) {
      span.setAttribute(
        intSemconv.ATTR_LANGWATCH_RAG_CONTEXTS,
        JSON.stringify({
          type: "json",
          value: JSON.stringify([ragContext]),
        }),
      );
    },
  };

  const handler: ProxyHandler<any> = {
    get(target, prop, _receiver) {
      if (prop in langwatchSpanMethods) {
        return langwatchSpanMethods[prop as keyof typeof langwatchSpanMethods];
      }

      const value = target[prop as keyof Span];
      return typeof value === "function" ? value.bind(target) : value;
    },
  };

  return new Proxy(span, handler) as LangWatchSpan;
}
