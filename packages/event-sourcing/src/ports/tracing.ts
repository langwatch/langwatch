import {
  type Attributes,
  type Span,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";

/**
 * Tracing uses the OpenTelemetry API directly rather than a port.
 *
 * It is the one signal with a standard interface designed for exactly this:
 * `@opentelemetry/api` is a peer dependency, and with no provider registered
 * every call is a no-op backed by a non-recording span. There is nothing for
 * the application to decide, so there is nothing to inject.
 *
 * Instrumentation goes on work that can fail, wait or fan out. Pure functions
 * are left alone — a span around a string renderer costs more than it explains,
 * and it buries the spans that matter.
 */

export const EVENT_SOURCING_TRACER = "langwatch:event-sourcing";

export function tracer() {
  return trace.getTracer(EVENT_SOURCING_TRACER);
}

/**
 * Runs `fn` inside a span, recording a thrown error before rethrowing.
 *
 * The rethrow is the point. A helper that swallowed the error would turn a
 * failed projection into a successful one that produced no state — the queue
 * would acknowledge the job and the aggregate would silently stop advancing,
 * which is the failure mode hardest to notice.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(
        error instanceof Error ? error : new Error(String(error)),
      );
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
