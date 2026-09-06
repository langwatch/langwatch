import { generate } from "@langwatch/ksuid";
import { SpanStatusCode } from "@opentelemetry/api";
import { ESpanKind } from "@opentelemetry/otlp-transformer-next/build/esm/trace/internal-types";
import { createHash } from "crypto";
import { getApp } from "~/server/app-layer/app";
import { DEFAULT_PII_REDACTION_LEVEL } from "~/server/event-sourcing/pipelines/trace-processing/schemas/commands";
import { TRACK_EVENT_SPAN_NAME } from "~/server/tracer/constants";
import type { TrackEventRESTParamsValidator } from "~/server/tracer/types";
import { KSUID_RESOURCES } from "~/utils/constants";

/**
 * Build the OTEL span for a tracked event and dispatch it through the
 * trace-processing event-sourcing pipeline.
 *
 * Shared between the legacy `POST /api/track_event` handler in misc.ts and
 * the new `POST /api/events/track` Hono module in
 * src/app/api/events/[[...route]]. Keep behaviour identical between the two
 * URLs by routing both through this function.
 */
export async function recordTrackedEventSpan(params: {
  project: { id: string };
  body: TrackEventRESTParamsValidator;
  eventId: string;
}): Promise<void> {
  const { project, body, eventId } = params;
  const timestampMs = body.timestamp ?? Date.now();
  const timestampNano = String(timestampMs * 1_000_000);
  const spanId = createHash("sha256")
    .update(`${body.trace_id}:${eventId}`)
    .digest("hex")
    .slice(0, 16);

  const attributes: {
    key: string;
    value: { stringValue?: string; doubleValue?: number };
  }[] = [
    { key: "event.type", value: { stringValue: body.event_type } },
    { key: "event.id", value: { stringValue: eventId } },
  ];

  for (const [key, value] of Object.entries(body.metrics)) {
    attributes.push({
      key: `event.metrics.${key}`,
      value: { doubleValue: value },
    });
  }

  if (body.event_details) {
    for (const [key, value] of Object.entries(body.event_details)) {
      if (typeof value === "string") {
        attributes.push({
          key: `event.details.${key}`,
          value: { stringValue: value },
        });
      } else if (typeof value === "number") {
        attributes.push({
          key: `event.details.${key}`,
          value: { doubleValue: value },
        });
      } else if (value != null) {
        attributes.push({
          key: `event.details.${key}`,
          value: { stringValue: String(value) },
        });
      }
    }
  }

  await getApp().traces.collection.ingestNormalizedSpan({
    tenantId: project.id,
    span: {
      traceId: body.trace_id,
      spanId,
      traceState: null,
      parentSpanId: null,
      name: TRACK_EVENT_SPAN_NAME,
      kind: ESpanKind.SPAN_KIND_INTERNAL,
      startTimeUnixNano: timestampNano,
      endTimeUnixNano: timestampNano,
      attributes,
      events: [
        {
          name: body.event_type,
          timeUnixNano: timestampNano,
          attributes,
        },
      ],
      links: [],
      status: { code: SpanStatusCode.OK as 1 },
      droppedAttributesCount: null,
      droppedEventsCount: null,
      droppedLinksCount: null,
    },
    resource: { attributes: [] },
    instrumentationScope: { name: TRACK_EVENT_SPAN_NAME },
    piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
  });
}

export function generateTrackedEventId(): string {
  return generate(KSUID_RESOURCES.TRACKED_EVENT).toString();
}
