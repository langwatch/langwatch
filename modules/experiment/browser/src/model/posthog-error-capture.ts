/**
 * Reports an exception as PostHog's `$exception` event, through the host's
 * analytics capability (CLAUDE.md rule 7: no module holds an analytics client).
 */

import type { UiAnalytics } from "@langwatch/browser-host/analytics";
import { isSpanContextValid, trace } from "@opentelemetry/api";

/**
 * Trace identity of the span that was active where the error was captured, so a PostHog
 * exception can be followed back to the trace it happened in — and from there, via
 * `~/utils/grafanaLinks`, straight into Tempo.
 */
function activeTraceContext(): { trace_id: string; span_id: string } | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) return void 0;

  return { trace_id: spanContext.traceId, span_id: spanContext.spanId };
}

/**
 * Converts an unknown value to an Error instance.
 * If the value is already an Error, returns it directly.
 * Otherwise, wraps it in a new Error using String() coercion.
 */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

type CaptureExceptionOptions = {
  extra?: Record<string, unknown>;
  tags?: Record<string, string>;
  level?: "error" | "warning" | "info" | "debug";
  contexts?: Record<string, unknown>;
};

/** Captures an exception/error as a PostHog `$exception` event. */
export function captureException({
  analytics,
  error,
  options,
}: {
  analytics: UiAnalytics;
  error: Error | string;
  options?: CaptureExceptionOptions;
}): void {
  const errorStack = error instanceof Error && error.stack ? error.stack : undefined;

  analytics.track({
    name: "$exception",
    attributes: {
      $exception_type: error instanceof Error ? error.constructor.name : "Error",
      $exception_message: error instanceof Error ? error.message : error,
      ...(errorStack && { $exception_stack_trace_raw: errorStack }),
      ...options?.extra,
      ...options?.tags,
      ...options?.contexts,
      $exception_level: options?.level ?? "error",
      // Last, so a colliding `extra`/`tags` key cannot quietly rewrite where this
      // was captured.
      ...activeTraceContext(),
    },
  });
}
