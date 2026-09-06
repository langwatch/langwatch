/**
 * Shared constants for OpenTelemetry attributes, tracer names, and sentinel values.
 * Safe for both browser and server environments.
 */

/**
 * Where a cause is attached on a record that is NOT at error level.
 *
 * A record we chose to log at warn should not carry a key called `error`,
 * which is the loudest possible claim that it failed. `severity_text` carries
 * the level we meant; the payload should not argue with it.
 *
 * It lives here rather than beside `logHttpRequest` because `logger.ts` has to
 * register a serializer for it and cannot import from `request/requestLogging`
 * without a cycle. Both ends must agree on the name: pino applies serializers
 * by exact key, so a field named here and not registered there is emitted as a
 * bare `Error` and loses its message and stack entirely.
 */
export const REQUEST_CAUSE_FIELD = "requestError";

/**
 * OpenTelemetry span attribute keys used across LangWatch services.
 */
export const OTEL_ATTR = {
  // Business context attributes
  ORGANIZATION_ID: "organization.id",
  TENANT_ID: "tenant.id",
  USER_ID: "user.id",
  SERVICE_NAME: "service.name",
  PROJECT_ID: "langwatch.project.id",

  // Observed trace/span attributes (for recording external system spans)
  OBSERVED_TRACE_ID: "observed.trace.id",
  OBSERVED_SPAN_ID: "observed.span.id",
  OBSERVED_PARENT_SPAN_ID: "observed.parent_span.id",
  OBSERVED_TIMESTAMP: "observed.timestamp",

  // Span metadata
  SPAN_KIND: "span.kind",
} as const;

/**
 * Tracer names used with `trace.getTracer()`.
 */
export const TRACER_NAMES = {
  NEXT_APP: "langwatch:next:app",
  NEXT_PAGES: "langwatch:next:pages",
  HONO: "langwatch:api:hono",
  COLLECTOR: "langwatch:collector",
  TRPC: "langwatch:trpc",
} as const;

/**
 * Invalid OTel trace ID sentinel (all zeros).
 */
export const INVALID_TRACE_ID = "00000000000000000000000000000000";

/**
 * Default service name for OTel resource attributes and logger configuration.
 */
export const DEFAULT_SERVICE_NAME = "langwatch-app";
