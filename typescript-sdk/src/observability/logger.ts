import {
  AnyValue,
  Logger,
  LoggerProvider,
  NoopLoggerProvider,
} from "@opentelemetry/api-logs";
import {
  EmitOptions,
  LangWatchLogger,
  LangWatchLogRecord,
  LangWatchSpanGenAIAssistantMessageEventBody,
  LangWatchSpanGenAIChoiceEventBody,
  LangWatchSpanGenAISystemMessageEventBody,
  LangWatchSpanGenAIToolMessageEventBody,
  LangWatchSpanGenAIUserMessageEventBody,
  SemConvLogRecordAttributes,
} from "./types";
import { shouldCaptureOutput } from "./config";
import * as intSemconv from "./semconv";
import { context } from "@opentelemetry/api";

let currentLoggerProvider: LoggerProvider = new NoopLoggerProvider();
let isProviderSet = false;

/**
 * @module observability/logger
 * @description
 * Provides LangWatch logger integration with OpenTelemetry, including logger provider management and logger creation utilities.
 *
 * @remarks
 * This module allows you to set a global logger provider, retrieve LangWatch loggers, and wrap OpenTelemetry loggers with LangWatch-specific functionality.
 *
 * @see {@link setLangWatchLoggerProvider}
 * @see {@link getLangWatchLogger}
 * @see {@link getLangWatchLoggerFromProvider}
 * @see {@link createLangWatchLogger}
 */
export function setLangWatchLoggerProvider(
  loggerProvider: LoggerProvider,
): void {
  if (isProviderSet) {
    console.warn(
      "LangWatch logger provider has already been set. Ignoring subsequent call.",
    );
    return;
  }
  currentLoggerProvider = loggerProvider;
  isProviderSet = true;
}

/**
 * Retrieves a LangWatch logger with the specified name and optional version.
 *
 * @param name - The name of the logger (typically your service or module name).
 * @param version - (Optional) The version of the logger.
 * @returns A {@link LangWatchLogger} instance.
 *
 * @remarks
 * Uses the logger provider set during observability setup. If no provider is set, returns a NoOp logger.
 *
 * @example
 * ```ts
 * const logger = getLangWatchLogger("my-service");
 * logger.info("Service started");
 * ```
 *
 * @see {@link setLangWatchLoggerProvider}
 */
export function getLangWatchLogger(
  name: string,
  version?: string,
): LangWatchLogger {
  return getLangWatchLoggerFromProvider(currentLoggerProvider, name, version);
}

/**
 * Retrieves a LangWatch logger from a specific OpenTelemetry logger provider.
 *
 * @param loggerProvider - The OpenTelemetry logger provider to use.
 * @param name - The name of the logger.
 * @param version - (Optional) The version of the logger.
 * @returns A {@link LangWatchLogger} instance.
 *
 * @remarks
 * Use this function if you want to use a custom logger provider instead of the global one.
 *
 * @example
 * ```ts
 * const customProvider = new LoggerProvider();
 * const logger = getLangWatchLoggerFromProvider(customProvider, "custom-service");
 * ```
 */
export function getLangWatchLoggerFromProvider(
  loggerProvider: LoggerProvider,
  name: string,
  version?: string,
): LangWatchLogger {
  return createLangWatchLogger(loggerProvider.getLogger(name, version));
}

/**
 * Wraps an OpenTelemetry logger as a LangWatch logger.
 *
 * @param logger - The OpenTelemetry logger to wrap.
 * @returns A {@link LangWatchLogger} instance.
 *
 * @example
 * ```ts
 * import { Logger } from "@opentelemetry/api-logs";
 * const otelLogger = new Logger();
 * const lwLogger = createLangWatchLogger(otelLogger);
 * lwLogger.info("Wrapped logger");
 * ```
 */
export function createLangWatchLogger(logger: Logger): LangWatchLogger {
  return new LangWatchLoggerInternal(logger);
}

/**
 * Internal implementation of {@link LangWatchLogger}.
 *
 * @remarks
 * This class wraps an OpenTelemetry logger and adds LangWatch-specific functionality for structured logging and event emission.
 * Not intended for direct use; use {@link getLangWatchLogger} or {@link createLangWatchLogger} instead.
 */
export class LangWatchLoggerInternal implements LangWatchLogger {
  constructor(private logger: Logger) {}

  emit(logRecord: LangWatchLogRecord, options?: EmitOptions): void {
    // Handle output capture configuration
    if (!shouldCaptureOutput()) {
      logRecord.body = void 0;
    }

    // Set context if not provided and not explicitly excluded
    if (!logRecord.context && !options?.excludeContext) {
      logRecord.context = context.active();
    }

    // Emit the log record through the underlying OpenTelemetry logger
    this.logger.emit(logRecord);
  }

  emitGenAISystemMessageEvent(
    body: LangWatchSpanGenAISystemMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemConvLogRecordAttributes,
  ): void {
    if (body.role === void 0) {
      body.role = "system";
    }

    this.emitGenAIEvent(
      intSemconv.LOG_EVNT_GEN_AI_SYSTEM_MESSAGE,
      { ...body },
      {
        ...attributes,
        "gen_ai.system": system,
      },
    );
  }

  emitGenAIUserMessageEvent(
    body: LangWatchSpanGenAIUserMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemConvLogRecordAttributes,
  ) {
    if (body.role === void 0) {
      body.role = "user";
    }

    this.emitGenAIEvent(
      intSemconv.LOG_EVNT_GEN_AI_USER_MESSAGE,
      { ...body },
      {
        ...attributes,
        "gen_ai.system": system,
      },
    );
  }

  emitGenAIAssistantMessageEvent(
    body: LangWatchSpanGenAIAssistantMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemConvLogRecordAttributes,
  ) {
    if (body.role === void 0) {
      body.role = "assistant";
    }

    this.emitGenAIEvent(
      intSemconv.LOG_EVNT_GEN_AI_ASSISTANT_MESSAGE,
      { ...body },
      {
        ...attributes,
        "gen_ai.system": system,
      },
    );
  }

  emitGenAIToolMessageEvent(
    body: LangWatchSpanGenAIToolMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemConvLogRecordAttributes,
  ) {
    if (body.role === void 0) {
      body.role = "tool";
    }

    this.emitGenAIEvent(
      intSemconv.LOG_EVNT_GEN_AI_TOOL_MESSAGE,
      { ...body },
      {
        ...attributes,
        "gen_ai.system": system,
      },
    );
  }

  emitGenAIChoiceEvent(
    body: LangWatchSpanGenAIChoiceEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemConvLogRecordAttributes,
  ) {
    if (body.message && body.message.role === void 0) {
      body.message.role = "assistant";
    }

    this.emitGenAIEvent(
      intSemconv.LOG_EVNT_GEN_AI_CHOICE,
      { ...body },
      {
        ...attributes,
        "gen_ai.system": system,
      },
    );
  }

  private emitGenAIEvent(
    eventName: string,
    body: AnyValue,
    attributes?: SemConvLogRecordAttributes,
  ): void {
    this.emit({
      eventName,
      context: context.active(),
      attributes: { ...attributes },
      body: shouldCaptureOutput() ? body : void 0,
      observedTimestamp: new Date().getTime(),
    });
  }
}
