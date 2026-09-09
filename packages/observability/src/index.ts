/**
 * Browser-safe public API for @langwatch/observability.
 *
 * Node context and OpenTelemetry helpers intentionally live behind the
 * `@langwatch/observability/context` and `@langwatch/observability/tracing` subpaths so
 * importing the logger in client code never evaluates those dependencies.
 */

export {
  DEFAULT_SERVICE_NAME,
  INVALID_TRACE_ID,
  OTEL_ATTR,
  REQUEST_CAUSE_FIELD,
  TRACER_NAMES,
} from "./constants.ts";
export type { JobContextMetadata, JobDataWithContext, RequestContext } from "./context/core.ts";
export {
  configureLogger,
  createLoggerFactory,
  type CreateLoggerOptions,
  consoleIgnoreFields,
  createLogger,
  type LoggerConfiguration,
  type LoggerFactory,
  type LoggerFormat,
  loggerConfigurationFrom,
  type Logger,
  type ProcessLoggerInputs,
  type ResolvedLoggerConfiguration,
} from "./logger.ts";
export {
  getLogLevelFromStatusCode,
  getStatusCodeFromError,
  hasAuthorizationToken,
  logHttpRequest,
  type RequestLogData,
} from "./request/requestLogging.ts";
export {
  MAX_VALIDATION_ISSUES,
  validationMeta,
  type ValidationIssueMeta,
  type ValidationMeta,
} from "./validation/validationMeta.ts";
export {
  processFailureLine,
  runScript,
  scriptFailureRecord,
  writeScriptWarning,
} from "./run-script.ts";
export { createWarnThrottle, type WarnThrottle } from "./warn-throttle.ts";
