import { ESpanKind, SpanStatusCode } from "@opentelemetry/api";
import { createHash } from "crypto";
import { generate } from "ksuid";
import { z } from "zod";

import { getApp } from "~/server/app-layer/app";
import { TRACK_EVENT_SPAN_NAME } from "~/server/tracer/constants";
import type { TrackEventRESTParamsValidator } from "~/server/tracer/types";
import { KSUID_RESOURCES } from "~/utils/constants";

const thumbsUpDownSchema = z.object({
  trace_id: z.string(),
  event_type: z.literal("thumbs_up_down"),
  metrics: z.object({ vote: z.number().min(-1).max(1) }),
  event_details: z
    .object({ feedback: z.string().nullish() })
    .optional(),
});

const selectedTextSchema = z.object({
  trace_id: z.string(),
  event_type: z.literal("selected_text"),
  metrics: z.object({ text_length: z.number().positive() }),
  event_details: z
    .object({ selected_text: z.string().optional() })
    .optional(),
});

const waitedToFinishSchema = z.object({
  trace_id: z.string(),
  event_type: z.literal("waited_to_finish"),
  metrics: z.object({ finished: z.number().min(0).max(1) }),
  event_details: z.object({}).optional(),
});

/**
 * Predefined event-type schemas (`thumbs_up_down`, `selected_text`,
 * `waited_to_finish`). Custom event types validate against
 * `trackEventRESTParamsValidatorSchema` only.
 */
export const predefinedEventsSchemas = z.union([
  thumbsUpDownSchema,
  selectedTextSchema,
  waitedToFinishSchema,
]);

export const predefinedEventTypes = predefinedEventsSchemas.options.map(
  (schema) => schema.shape.event_type.value,
);

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
  project: { id: string; piiRedactionLevel: string };
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

  await getApp().traces.recordSpan({
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
    piiRedactionLevel: project.piiRedactionLevel,
    occurredAt: Date.now(),
  });
}

export function generateTrackedEventId(): string {
  return generate(KSUID_RESOURCES.TRACKED_EVENT).toString();
}
