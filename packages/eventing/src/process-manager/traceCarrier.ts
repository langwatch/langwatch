import { context, propagation } from "@opentelemetry/api";

/**
 * The active W3C propagation carrier, so an outbox dispatch continues this trace as its remote
 * parent. Every minted message carries it: an empty `{}` extracts to a root, orphaning the span.
 */
export function captureTraceCarrier(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}
