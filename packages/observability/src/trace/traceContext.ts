/**
 * Injects W3C trace context headers into outbound HTTP requests, using
 * @opentelemetry/api propagation to inject `traceparent` from the active
 * OTEL context. Silently no-ops when no active OTEL context exists.
 */

import { context as otelContext, propagation, trace } from "@opentelemetry/api";

import { INVALID_TRACE_ID } from "../constants.ts";

interface InjectResult {
  headers: Record<string, string>;
  traceId: string | undefined;
}

/**
 * Injects trace context headers into the given record, mutating it in
 * place, and returns it with the captured trace ID — `traceparent`
 * (optionally `tracestate`) via W3C propagation, for explicit propagation to the judge.
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
