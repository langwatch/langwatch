import { createHash } from "node:crypto";

import {
  TRACK_EVENT_SPAN_NAME,
  type OtlpKeyValue,
  type OtlpSpan,
  type TrackEventRESTParamsValidator,
} from "@langwatch/trace-contract";
import { ESpanKind } from "@opentelemetry/otlp-transformer-next/build/esm/trace/internal-types.js";

/** How many hex characters an OTLP span id carries. */
const SPAN_ID_LENGTH = 16;

/** Nanoseconds in a millisecond, the unit the wire carries timestamps in. */
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

/** The span id derives from trace and event IDs, making retries idempotent. */
/** The span id a given event on a given trace always has. */
function deriveSpanId(input: Readonly<{ traceId: string; eventId: string }>): string {
  return createHash("sha256")
    .update(`${input.traceId}:${input.eventId}`)
    .digest("hex")
    .slice(0, SPAN_ID_LENGTH);
}

/**
 * The event's metrics and details, flattened onto the `event.` prefix the
 * explorer reads. A detail that is neither string nor number is written as
 * its string form rather than dropped, which is what the monolith did.
 */
function buildAttributes(
  input: Readonly<{ body: TrackEventRESTParamsValidator; eventId: string }>,
): OtlpKeyValue[] {
  const attributes: OtlpKeyValue[] = [
    { key: "event.type", value: { stringValue: input.body.event_type } },
    { key: "event.id", value: { stringValue: input.eventId } },
  ];

  for (const [key, value] of Object.entries(input.body.metrics)) {
    attributes.push({ key: `event.metrics.${key}`, value: { doubleValue: value } });
  }

  for (const [key, value] of Object.entries(input.body.event_details ?? {})) {
    if (value === null || value === undefined) continue;
    attributes.push({
      key: `event.details.${key}`,
      value:
        typeof value === "number"
          ? { doubleValue: value }
          : { stringValue: typeof value === "string" ? value : String(value) },
    });
  }

  return attributes;
}

/** The whole span, ready for the ingress command. */
export function buildTrackedEventSpan(
  input: Readonly<{
    body: TrackEventRESTParamsValidator;
    eventId: string;
    occurredAtMs: number;
  }>,
): OtlpSpan {
  const timestampNano = String(input.occurredAtMs * NANOSECONDS_PER_MILLISECOND);
  const attributes = buildAttributes({
    body: input.body,
    eventId: input.eventId,
  });

  return {
    traceId: input.body.trace_id,
    spanId: deriveSpanId({
      traceId: input.body.trace_id,
      eventId: input.eventId,
    }),
    traceState: null,
    parentSpanId: null,
    name: TRACK_EVENT_SPAN_NAME,
    kind: ESpanKind.SPAN_KIND_INTERNAL,
    startTimeUnixNano: timestampNano,
    endTimeUnixNano: timestampNano,
    attributes,
    events: [{ name: input.body.event_type, timeUnixNano: timestampNano, attributes }],
    links: [],
    status: { message: null, code: 1 },
    flags: null,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}
