/**
 * Injects W3C trace context headers into outbound HTTP requests.
 *
 * Uses @opentelemetry/api propagation to inject `traceparent` from the
 * active OTEL context. Silently no-ops when no active OTEL context exists.
 */

import { context as otelContext, propagation, trace } from "@opentelemetry/api";
import { INVALID_TRACE_ID } from "../constants";

interface InjectResult {
  headers: Record<string, string>;
  traceId: string | undefined;
}

/**
 * Injects trace context headers into the given headers record.
 * Mutates the headers object in place and returns it along with the captured trace ID.
 *
 * - Injects `traceparent` (and optionally `tracestate`) via W3C propagation
 * - Captures the active trace ID for explicit propagation to the judge
 */
export function injectTraceContextHeaders({
  headers,
}: {
  headers: Record<string, string>;
}): InjectResult {
  // Inject W3C traceparent from active OTEL context
  const activeContext = otelContext.active();
  propagation.inject(activeContext, headers);

  // Capture trace ID at injection time for explicit propagation
  const traceId = getActiveTraceId();

  return { headers, traceId };
}

/**
 * Extracts the trace ID from the currently active OTEL span context.
 * Returns undefined if no active span exists or the trace ID is invalid.
 */
export function getActiveTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  if (!span) return undefined;

  const traceId = span.spanContext().traceId;
  if (!traceId || traceId === INVALID_TRACE_ID) {
    return undefined;
  }

  return traceId;
}

/**
 * Copies diagnostic context onto the active span, so it survives to somewhere
 * it can be searched.
 *
 * Passing the same fields to the logger is not equivalent, and this exists
 * because of the difference. Production ships stdout through a collector that
 * keeps a record's MESSAGE and drops its structured fields, so a
 * `logger.warn({ projectId, evaluatorType }, "...")` arrives as the bare
 * sentence: you can count the failures but you cannot say whose they are, or
 * group them, or tell one cause from another. Span attributes are not on that
 * path. The log line already carries the trace id, so recording the same
 * context here is what turns a countable line into an attributable one.
 *
 * Use it at the sites where the answer to "who/which/why" lives, and pass the
 * identifiers rather than a rendered sentence — an attribute is worth having
 * because it can be filtered on.
 *
 * Best-effort by construction. No active span (a code path outside a trace,
 * tracing disabled in a test) records nothing and never throws, and null or
 * undefined values are skipped so optional context can be passed inline
 * without the caller building the object conditionally.
 */
export function recordOnActiveSpan(
  attributes: Record<string, string | number | boolean | null | undefined>,
): void {
  const span = trace.getActiveSpan();
  if (!span) return;

  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) continue;
    span.setAttribute(key, value);
  }
}
