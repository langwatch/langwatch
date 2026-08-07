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
} from "./constants";
export type {
  JobContextMetadata,
  JobDataWithContext,
  RequestContext,
} from "./context/core";
export {
  type CreateLoggerOptions,
  consoleIgnoreFields,
  createLogger,
  type Logger,
} from "./logger";
export {
  getLogLevelFromStatusCode,
  getStatusCodeFromError,
  hasAuthorizationToken,
  logHttpRequest,
  type RequestLogData,
} from "./request/requestLogging";
export {
  MAX_VALIDATION_ISSUES,
  validationMeta,
  type ValidationIssueMeta,
  type ValidationMeta,
} from "./validation/validationMeta";
