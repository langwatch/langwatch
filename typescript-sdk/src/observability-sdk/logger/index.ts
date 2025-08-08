import {
  Logger,
  LoggerProvider,
  NoopLoggerProvider,
} from "@opentelemetry/api-logs";
import {
  LangWatchLogger,
} from "./types";
import { LangWatchLoggerInternal } from "./implementation";

/**
 * The LangWatch-specific global logger provider. It may not be the same as the current
 * OpenTelemetry global logger provider, but it's the last one the `setupObservability`
 * knows about.
 * @internal
 */
let currentLoggerProvider: LoggerProvider = new NoopLoggerProvider();

/**
 * @module observability/logger
 * @description
 * Provides LangWatch logger integration with OpenTelemetry, including logger provider
 * management and logger creation utilities.
 *
 * @remarks
 * This module allows you to set a global logger provider, retrieve LangWatch loggers,
 * and wrap OpenTelemetry loggers with LangWatch-specific functionality.
 *
 * @see {@link setLangWatchLoggerProvider}
 * @see {@link getLangWatchLogger}
 * @see {@link getLangWatchLoggerFromProvider}
 * @see {@link createLangWatchLogger}
 */
export function setLangWatchLoggerProvider(
  loggerProvider: LoggerProvider,
): void {
  currentLoggerProvider = loggerProvider;
}

/**
 * Retrieves a LangWatch logger with the specified name and optional version.
 *
 * @param name - The name of the logger (typically your service or module name).
 * @param version - (Optional) The version of the logger.
 * @returns A {@link LangWatchLogger} instance.
 *
 * @remarks
 * Uses the logger provider set during observability setup. If no provider is set, returns
 * a NoOp logger.
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

// Export types and implementation
export * from "./types";
export * from "./implementation";
