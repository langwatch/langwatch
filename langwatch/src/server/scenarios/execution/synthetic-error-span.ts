/**
 * Creates a synthetic ReadableSpan representing an infrastructure error
 * during span collection from Elasticsearch.
 *
 * This span surfaces the failure reason in the judge's trace digest
 * so the judge can distinguish "no spans available" from
 * "span collection failed".
 */

import { SpanKind, SpanStatusCode, TraceFlags } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { emptyResource } from "@opentelemetry/resources";

const ERROR_SPAN_NAME = "langwatch.span_collection.error";

interface SyntheticErrorSpanParams {
  traceId: string;
  reason: string;
}

/**
 * Creates a ReadableSpan representing a span collection error.
 *
 * The span is named "langwatch.span_collection.error" and includes
 * the failure reason in its attributes and status message.
 */
export function createSyntheticErrorSpan({
  traceId,
  reason,
}: SyntheticErrorSpanParams): ReadableSpan {
  const now = Date.now();
  const seconds = Math.trunc(now / 1000);
  const nanoseconds = (now % 1000) * 1_000_000;
  const startTime: [number, number] = [seconds, nanoseconds];

  return {
    name: ERROR_SPAN_NAME,
    kind: SpanKind.INTERNAL,
    spanContext: () => ({
      traceId,
      spanId: generateSpanId(),
      traceFlags: TraceFlags.SAMPLED,
    }),
    parentSpanContext: undefined,
    startTime,
    endTime: startTime,
    status: { code: SpanStatusCode.ERROR, message: reason },
    attributes: {
      "langwatch.span_collection.error": true,
      "langwatch.span_collection.error.reason": reason,
    },
    links: [],
    events: [],
    duration: [0, 0],
    ended: true,
    resource: emptyResource(),
    instrumentationScope: { name: "langwatch.scenario" },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
