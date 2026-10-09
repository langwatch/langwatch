import { context, propagation } from "@opentelemetry/api";

/**
 * Captures the full active W3C propagation carrier
 * (traceparent/tracestate/baggage as configured on the global propagator)
 * so an outbox dispatch can continue this trace as its remote parent.
 *
 * Every minted outbox message must carry this rather than `{}`: an empty
 * carrier extracts to a root context, and the dispatch becomes an orphan
 * span with no path back to the work that minted it.
 */
export function captureTraceCarrier(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}
