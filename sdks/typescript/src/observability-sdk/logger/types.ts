import { type Logger, type LogRecord } from "@opentelemetry/api-logs";

import type * as intSemconv from "../semconv";
import { type SemConvAttributes, type SemConvLogRecordAttributes } from "../semconv";

/** Body for a system message event in a GenAI span (a system/instruction to the model). */
export interface LangWatchSpanGenAISystemMessageEventBody {
  /** Content of the system message */
  content?: string;
  /** Role of the message (system or instruction) */
  role?: "system" | "instruction";
}

/** Body for a user message event in a GenAI span (a user/customer message to the model). */
export interface LangWatchSpanGenAIUserMessageEventBody {
  /** Content of the user message */
  content?: string;
  /** Role of the message (user or customer) */
  role?: "user" | "customer";
}

/** Body for an assistant message event in a GenAI span (a response, including tool calls). */
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

/** Body for a tool message event in a GenAI span (a message from a tool the assistant invoked). */
export interface LangWatchSpanGenAIToolMessageEventBody {
  /** Content of the tool message */
  content?: string;
  /** Tool call identifier */
  id: string;
  /** Role of the message (tool or function) */
  role?: "tool" | "function";
}

/** Body for a choice event in a GenAI span (a model output choice, finish reason and message). */
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
   * Whether to omit the OTel context from the log record — standard OpenTelemetry
   * omits it by default, so set this to avoid attaching context to every record.
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
   * Emit a GenAI system/instruction message event to the logger.
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
   * Emit a GenAI user/customer message event to the logger.
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
   * Emit a GenAI assistant/bot message event to the logger (including tool calls, if any).
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
   * Emit a GenAI tool/function message event to the logger (from a tool the assistant invoked).
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
   * Emit a GenAI choice event to the logger (a model output choice, finish reason, message).
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
