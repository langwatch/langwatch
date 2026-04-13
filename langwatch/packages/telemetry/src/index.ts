/**
 * @langwatch/telemetry
 *
 * Provides logging, context propagation, and OpenTelemetry utilities
 * for LangWatch services.
 */

// Logger (isomorphic — works in both server and browser)
export { createLogger, type CreateLoggerOptions, type Logger } from "./logger";

// Context propagation
export {
  type RequestContext,
  type JobContextMetadata,
  getCurrentContext,
  runWithContext,
  updateCurrentContext,
  getOtelSpanContext,
} from "./context/core";

// Logging context
export { getLogContext } from "./context/logging";

// HTTP request logging
export {
  logHttpRequest,
  getStatusCodeFromError,
  getLogLevelFromStatusCode,
  hasAuthorizationToken,
  type RequestLogData,
} from "./request/requestLogging";

// Trace context propagation
export { injectTraceContextHeaders, getActiveTraceId } from "./trace/traceContext";

// Constants
export {
  OTEL_ATTR,
  TRACER_NAMES,
  INVALID_TRACE_ID,
  DEFAULT_SERVICE_NAME,
} from "./constants";
