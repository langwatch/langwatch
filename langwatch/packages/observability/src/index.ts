/**
 * @langwatch/observability - Server entry point
 *
 * Provides logging, context propagation, and OpenTelemetry utilities
 * for LangWatch services. For browser-safe imports, use '@langwatch/observability/browser'.
 */

// Server logger (with context injection + transports)
export { createLogger, type CreateLoggerOptions, type Logger } from "./logger/server";

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
