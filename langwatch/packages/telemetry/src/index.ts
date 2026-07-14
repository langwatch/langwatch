/**
 * Browser-safe public API for @langwatch/telemetry.
 *
 * Node context and OpenTelemetry helpers intentionally live behind the
 * `@langwatch/telemetry/context` and `@langwatch/telemetry/tracing` subpaths so
 * importing the logger in client code never evaluates those dependencies.
 */

export {
  DEFAULT_SERVICE_NAME,
  INVALID_TRACE_ID,
  OTEL_ATTR,
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
