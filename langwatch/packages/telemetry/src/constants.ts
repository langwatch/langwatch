/**
 * Shared constants for OpenTelemetry attributes, tracer names, and sentinel values.
 * Safe for both browser and server environments.
 */

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
export const DEFAULT_SERVICE_NAME = "langwatch-backend";
