import {
  type Logger,
  type LoggerOptions,
  type LoggerProvider,
  createNoopLogger,
} from "@opentelemetry/api-logs";

import { LangWatchLoggerInternal } from "./implementation";
import { type LangWatchLogger } from "./types";

/**
 * `NoopLoggerProvider` was dropped from @opentelemetry/api-logs' public exports
 * (0.221) in favour of the still-exported `createNoopLogger`, so this is its
 * replacement: a provider whose loggers are always the shared no-op logger.
 */
const NOOP_LOGGER_PROVIDER: LoggerProvider = {
  getLogger: (_name: string, _version?: string, _options?: LoggerOptions) => createNoopLogger(),
};

/**
 * The LangWatch-specific global logger provider -- may differ from the
 * current OTel one; the last one `setupObservability` knows about.
 * @internal
 */
let currentLoggerProvider: LoggerProvider = NOOP_LOGGER_PROVIDER;

/** Sets the global logger provider that {@link getLangWatchLogger} will use. */
export function setLangWatchLoggerProvider(loggerProvider: LoggerProvider): void {
  currentLoggerProvider = loggerProvider;
}

/**
 * @param name - The logger name (typically your service or module name).
 * @param version - Optional logger version.
 * @returns A {@link LangWatchLogger} instance, or a no-op logger if no provider was set.
 */
export function getLangWatchLogger(name: string, version?: string): LangWatchLogger {
  return getLangWatchLoggerFromProvider(currentLoggerProvider, name, version);
}

/**
 * @param loggerProvider - The OpenTelemetry logger provider to use.
 * @param name - The name of the logger.
 * @param version - Optional logger version.
 * @returns A {@link LangWatchLogger} instance.
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
 * @param logger - The OpenTelemetry logger to wrap.
 * @returns A {@link LangWatchLogger} instance.
 */
export function createLangWatchLogger(logger: Logger): LangWatchLogger {
  return new LangWatchLoggerInternal(logger);
}

// Export types and implementation
export * from "./types";
export * from "./implementation";
