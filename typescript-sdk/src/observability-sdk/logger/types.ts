import {
  Logger,
  LogRecord,
} from "@opentelemetry/api-logs";
import * as intSemconv from "../semconv";
import {
  type SemConvAttributes,
  type SemConvLogRecordAttributes,
} from "../semconv";

/**
 * Body for a system message event in a GenAI span.
 *
 * Used to log system/instruction messages sent to the model.
 *
 * @property content - The message content.
 * @property role - The role of the message, typically 'system' or 'instruction'.
 *
 * @example
 * logger.emitGenAISystemMessageEvent({ content: 'You are a helpful assistant.' });
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
 * logger.emitGenAIUserMessageEvent({ content: 'What is the weather today?' });
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
 * logger.emitGenAIAssistantMessageEvent({ content: 'The weather is sunny.', role: 'assistant' });
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
 * logger.emitGenAIToolMessageEvent({ content: 'Result from tool', id: 'tool-1', role: 'tool' });
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
 * logger.emitGenAIChoiceEvent({ finish_reason: 'stop', index: 0, message: { content: 'Hello!' } });
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
 * Extension of OpenTelemetry's LogRecord with LangWatch and GenAI-specific attributes.
 */
export interface LangWatchLogRecord extends LogRecord {
  /**
   * Additional attributes to add to the log record.
   *
   * @default {}
   */
  attributes?: SemConvLogRecordAttributes;
}

/**
 * Options for emitting a log record.
 */
export interface EmitOptions {
  /**
   * Whether to not include the OTel context on the log record.
   *
   * With standard OpenTelemetry, the context is not included on the log record by
   * default, so this is useful if you want to emit a lot without having to manually
   * set the context on each log record.
   *
   * @default false
   */
  excludeContext?: boolean;
}

/**
 * Extension of OpenTelemetry's Logger with LangWatch and GenAI-specific methods.
 */
export interface LangWatchLogger extends Logger {
  /**
   * Emit a log record with LangWatch and GenAI-specific attributes.
   *
   * @param logRecord - The log record to emit
   * @param options - Optional options for emitting the log record
   */
  emit(logRecord: LangWatchLogRecord, options?: EmitOptions): void;

  /**
   * Emit a GenAI system message event to the logger.
   *
   * This logs a system/instruction message sent to the model.
   *
   * @param body - The event body (content and role)
   * @param system - The GenAI system (optional, e.g., 'openai', 'anthropic')
   * @param attributes - Additional OpenTelemetry attributes (optional)
   * @returns this
   */
  emitGenAISystemMessageEvent(
    body: LangWatchSpanGenAISystemMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemConvAttributes,
  ): void;
  /**
   * Emit a GenAI user message event to the logger.
   *
   * This logs a user/customer message sent to the model.
   *
   * @param body - The event body (content and role)
   * @param system - The GenAI system (optional)
   * @param attributes - Additional OpenTelemetry attributes (optional)
   * @returns this
   */
  emitGenAIUserMessageEvent(
    body: LangWatchSpanGenAIUserMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemConvAttributes,
  ): void;
  /**
   * Emit a GenAI assistant message event to the logger.
   *
   * This logs an assistant/bot response, including tool calls if present.
   *
   * @param body - The event body (content, role, tool_calls)
   * @param system - The GenAI system (optional)
   * @param attributes - Additional OpenTelemetry attributes (optional)
   * @returns this
   */
  emitGenAIAssistantMessageEvent(
    body: LangWatchSpanGenAIAssistantMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemConvAttributes,
  ): void;
  /**
   * Emit a GenAI tool message event to the logger.
   *
   * This logs a message from a tool/function invoked by the assistant.
   *
   * @param body - The event body (content, id, role)
   * @param system - The GenAI system (optional)
   * @param attributes - Additional OpenTelemetry attributes (optional)
   * @returns this
   */
  emitGenAIToolMessageEvent(
    body: LangWatchSpanGenAIToolMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemConvAttributes,
  ): void;
  /**
   * Emit a GenAI choice event to the logger.
   *
   * This logs a model output choice, including finish reason and message content.
   *
   * @param body - The event body (finish_reason, index, message)
   * @param system - The GenAI system (optional)
   * @param attributes - Additional OpenTelemetry attributes (optional)
   * @returns this
   */
  emitGenAIChoiceEvent(
    body: LangWatchSpanGenAIChoiceEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemConvAttributes,
  ): void;
}
