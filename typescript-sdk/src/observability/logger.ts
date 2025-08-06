import { Logger, LoggerProvider, NoopLoggerProvider } from "@opentelemetry/api-logs";
import { EmitOptions, LangWatchLogger, LangWatchLogRecord, LangWatchSpanGenAIAssistantMessageEventBody, LangWatchSpanGenAIChoiceEventBody, LangWatchSpanGenAISystemMessageEventBody, LangWatchSpanGenAIToolMessageEventBody, LangWatchSpanGenAIUserMessageEventBody, SemconvAttributes } from "./types";
import { shouldCaptureOutput } from "./config";
import * as intSemconv from "./semconv";
import { context } from "@opentelemetry/api";

// Default to NoOp logger provider to avoid global state issues
let currentLoggerProvider: LoggerProvider = new NoopLoggerProvider();

/**
 * Set the logger provider for LangWatch logging.
 *
 * This should be called during observability setup to provide
 * the LangWatch logger provider. If not called, a NoOp logger
 * will be used.
 *
 * @param loggerProvider - The OpenTelemetry logger provider to use
 */
export function setLangWatchLoggerProvider(loggerProvider: LoggerProvider): void {
  currentLoggerProvider = loggerProvider;
}

/**
 * Get a LangWatch logger with the given name and version.
 *
 * This function uses the logger provider set during observability setup.
 * If no provider was set, a NoOp logger will be returned.
 *
 * @param name - The name of the logger
 * @param version - The version of the logger
 * @returns A LangWatch logger
 *
 * @example
 * ```typescript
 * // Setup observability (this will set the logger provider internally)
 * setupObservability({
 *   apiKey: "your-api-key",
 *   serviceName: "my-service"
 * });
 *
 * // Now you can use the logger anywhere in your app
 * const logger = getLangWatchLogger("my-service");
 * logger.info("Hello from LangWatch!");
 *
 * // With version
 * const logger = getLangWatchLogger("my-service", "1.0.0");
 *
 * // If no setup was done, this will use a NoOp logger (no-op)
 * const logger = getLangWatchLogger("my-service");
 * logger.info("This won't be sent anywhere");
 * ```
 */
export function getLangWatchLogger(
  name: string,
  version?: string,
): LangWatchLogger {
  return getLangWatchLoggerFromProvider(currentLoggerProvider, name, version);
}

/**
 * Get a LangWatch logger from a specific OpenTelemetry logger provider.
 *
 * This function is useful when you want to use a specific logger provider
 * instead of the one set during setup.
 *
 * @param loggerProvider - The OpenTelemetry logger provider to use
 * @param name - The name of the logger
 * @param version - The version of the logger
 * @returns A LangWatch logger
 *
 * @example
 * ```typescript
 * // With your own provider
 * const customProvider = new LoggerProvider({...});
 * const logger = getLangWatchLoggerFromProvider(customProvider, "my-service");
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
 * Create a LangWatch logger from an OpenTelemetry logger.
 *
 * @param logger - The OpenTelemetry logger to wrap
 * @returns A LangWatch logger
 */
export function createLangWatchLogger(logger: Logger): LangWatchLogger {
  return new LangWatchLoggerInternal(logger);
}

/**
 * Internal implementation of LangWatchLogger.
 *
 * This class wraps an OpenTelemetry logger and adds LangWatch-specific functionality.
 */
export class LangWatchLoggerInternal implements LangWatchLogger {
  constructor(private logger: Logger) { }

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
    attributes?: SemconvAttributes,
  ): void {
    if (body.role === void 0) {
      body.role = "system";
    }

    this.emit({
      eventName: intSemconv.LOG_EVNT_GEN_AI_SYSTEM_MESSAGE,
      context: context.active(),
      attributes: {
        ...attributes,
        "gen_ai.system": system,
      },
      body: shouldCaptureOutput() ? { ...body } : void 0,
      observedTimestamp: new Date().getTime(),
    });
  }

  emitGenAIUserMessageEvent(
    body: LangWatchSpanGenAIUserMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemconvAttributes,
  ) {
    if (body.role === void 0) {
      body.role = "user";
    }

    this.emit({
      eventName: intSemconv.LOG_EVNT_GEN_AI_USER_MESSAGE,
      context: context.active(),
      attributes: {
        ...attributes,
        "gen_ai.system": system,
      },
      body: shouldCaptureOutput() ? { ...body } : void 0,
      observedTimestamp: new Date().getTime(),
    });
  }

  emitGenAIAssistantMessageEvent(
    body: LangWatchSpanGenAIAssistantMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemconvAttributes,
  ) {
    if (body.role === void 0) {
      body.role = "assistant";
    }

    this.emit({
      eventName: intSemconv.LOG_EVNT_GEN_AI_ASSISTANT_MESSAGE,
      context: context.active(),
      attributes: {
        ...attributes,
        "gen_ai.system": system,
      },
      body: shouldCaptureOutput() ? { ...body } : void 0,
      observedTimestamp: new Date().getTime(),
    });
  }

  emitGenAIToolMessageEvent(
    body: LangWatchSpanGenAIToolMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemconvAttributes,
  ) {
    if (body.role === void 0) {
      body.role = "tool";
    }

    this.emit({
      eventName: intSemconv.LOG_EVNT_GEN_AI_TOOL_MESSAGE,
      context: context.active(),
      attributes: {
        ...attributes,
        "gen_ai.system": system,
      },
      body: shouldCaptureOutput() ? { ...body } : void 0,
      observedTimestamp: new Date().getTime(),
    });
  }

  emitGenAIChoiceEvent(
    body: LangWatchSpanGenAIChoiceEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemconvAttributes,
  ) {
    if (body.message && body.message.role === void 0) {
      body.message.role = "assistant";
    }

    this.emit({
      eventName: intSemconv.LOG_EVNT_GEN_AI_CHOICE,
      context: context.active(),
      attributes: {
        ...attributes,
        "gen_ai.system": system,
      },
      body: shouldCaptureOutput() ? { ...body } : void 0,
      observedTimestamp: new Date().getTime(),
    });
  }
}
