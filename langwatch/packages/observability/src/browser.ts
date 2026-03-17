/**
 * @langwatch/observability/browser - Browser-safe entry point
 *
 * Provides browser-compatible logging and trace utilities.
 * No Node.js APIs (AsyncLocalStorage, transports) are used.
 */

// Browser logger (pino browser mode, no ALS/transports)
export { createLogger, type Logger } from "./logger/browser";

// Trace ID extraction (uses @opentelemetry/api which is browser-safe)
export { getActiveTraceId } from "./trace/traceContext";

// Constants (plain objects, browser-safe)
export {
  OTEL_ATTR,
  TRACER_NAMES,
  INVALID_TRACE_ID,
  DEFAULT_SERVICE_NAME,
} from "./constants";
