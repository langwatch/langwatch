/**
 * Injects W3C trace context and LangWatch correlation headers
 * into outbound HTTP requests for scenario execution.
 *
 * Uses @opentelemetry/api propagation to inject `traceparent` from the
 * active OTEL context, and adds `x-langwatch-scenario-run` for
 * platform-level correlation.
 *
 * Silently no-ops when no active OTEL context exists.
 */

import {
  context as otelContext,
  propagation,
  trace,
} from "@opentelemetry/api";

const LANGWATCH_SCENARIO_RUN_HEADER = "x-langwatch-scenario-run";

interface InjectResult {
  headers: Record<string, string>;
  traceId: string | undefined;
}

/**
 * Injects trace context headers into the given headers record.
 * Mutates the headers object in place and returns it along with the captured trace ID.
 *
 * - Injects `traceparent` (and optionally `tracestate`) via W3C propagation
 * - Injects `x-langwatch-scenario-run` with the batch run ID
 * - Captures the active trace ID for explicit propagation to the judge
 *
 * When no active OTEL context exists, only the correlation header is added.
 */
export function injectTraceContextHeaders({
  headers,
  batchRunId,
}: {
  headers: Record<string, string>;
  batchRunId?: string;
}): InjectResult {
  // Inject W3C traceparent from active OTEL context
  const activeContext = otelContext.active();
  propagation.inject(activeContext, headers);

  // Capture trace ID at injection time for explicit propagation
  const traceId = getActiveTraceId();

  // Inject LangWatch correlation header
  if (batchRunId) {
    headers[LANGWATCH_SCENARIO_RUN_HEADER] = batchRunId;
  }

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
  // OTEL uses "00000000000000000000000000000000" as invalid trace ID
  if (!traceId || traceId === "00000000000000000000000000000000") {
    return undefined;
  }

  return traceId;
}
