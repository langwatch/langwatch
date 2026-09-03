import { createHash } from "node:crypto";
import { SpanStatusCode } from "@opentelemetry/api";
import { ESpanKind } from "@opentelemetry/otlp-transformer-next/build/esm/trace/internal-types";
import { generate } from "@langwatch/ksuid";
import {
  DEFAULT_PII_REDACTION_LEVEL,
  TRACK_EVENT_SPAN_NAME,
  type TrackEventRESTParamsValidator,
} from "@langwatch/trace-contract";
import type { TraceSpanCollectionService } from "./trace-ingestion.service";

/**
 * The ksuid prefix every tracked-event id ever written carries.
 *
 * A literal rather than an import: the platform's `KSUID_RESOURCES` map is not
 * published by any contract package, and this prefix is part of ids already in
 * customers' databases — so it is pinned here and pinned again in the test,
 * exactly as `evaluation-trigger.subscriber.ts` pins the evaluation prefix.
 */
const TRACKED_EVENT_KSUID_RESOURCE = "trackedevent";

/**
 * Turns a tracked event into the one synthetic span that carries it.
 *
 * WHY IT IS A SPAN AT ALL. `POST /api/events/track` and the live-feedback
 * reactor both record a customer's thumbs-up, score or flag against a trace,
 * and the only durable home for that is the trace's own span stream — so both
 * mint a span whose attributes ARE the event, and let the normal fold pick it
 * up. Which means the two paths must mint the SAME span: the span id is a
 * deterministic digest of `${trace_id}:${eventId}`, so a REST call retried by a
 * customer and a reactor redelivered by the queue collapse onto one row instead
 * of scoring the trace twice.
 *
 * WHAT MOVED AND WHY. The builder was in the application, and its one reason
 * for being there was the last line: it dispatched through `getApp()`, the
 * process-wide singleton a package may not have. The dispatch target underneath
 * that singleton was already this package's own span collection, so the harvest
 * is the BUILDER — the id digest, the attribute encoding and the event shape —
 * and the collaborator is named rather than looked up.
 *
 * THE ATTRIBUTE ENCODING IS A WIRE FORMAT between this and the fold that reads
 * it back, and it is duplicated deliberately: the same attribute list is set
 * both on the span AND on a span event named after the event type, because the
 * summary projection reads the span attributes and the event list is what a
 * customer sees on the trace's timeline.
 */
export class TrackedEventSpanService {
  private constructor(private readonly collection: TraceSpanCollectionService) {}

  static create(options: { collection: TraceSpanCollectionService }): TrackedEventSpanService {
    return new TrackedEventSpanService(options.collection);
  }

  /** A fresh tracked-event id, in the shape every stored one already has. */
  static generateEventId(): string {
    return generate(TRACKED_EVENT_KSUID_RESOURCE).toString();
  }

  /**
   * The span id both paths must agree on.
   *
   * Sixteen hex characters because that is an OTLP span id; a digest rather
   * than a random value because idempotency here is the difference between one
   * recorded rating and two.
   */
  static spanIdFor(input: { traceId: string; eventId: string }): string {
    return createHash("sha256")
      .update(`${input.traceId}:${input.eventId}`)
      .digest("hex")
      .slice(0, 16);
  }

  async record(input: {
    tenantId: string;
    body: TrackEventRESTParamsValidator;
    eventId: string;
  }): Promise<void> {
    const { tenantId, body, eventId } = input;
    const timestampMs = body.timestamp ?? Date.now();
    const timestampNano = String(timestampMs * 1_000_000);
    const spanId = TrackedEventSpanService.spanIdFor({ traceId: body.trace_id, eventId });
    const attributes = TrackedEventSpanService.attributesFor({ body, eventId });

    await this.collection.ingestNormalizedSpan({
      tenantId,
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

  /**
   * The event as OTLP attributes.
   *
   * Metrics are always numbers and details may be anything the customer sent,
   * so details are typed one value at a time and everything else is
   * stringified rather than dropped — a detail we cannot type is still a
   * detail the customer wanted to see. `null` and `undefined` are the one
   * exception: an absent value carries nothing, and writing `"null"` onto the
   * span would make it look like the customer sent that word.
   */
  private static attributesFor(input: {
    body: TrackEventRESTParamsValidator;
    eventId: string;
  }): { key: string; value: { stringValue?: string; doubleValue?: number } }[] {
    const attributes: {
      key: string;
      value: { stringValue?: string; doubleValue?: number };
    }[] = [
      { key: "event.type", value: { stringValue: input.body.event_type } },
      { key: "event.id", value: { stringValue: input.eventId } },
    ];

    for (const [key, value] of Object.entries(input.body.metrics)) {
      attributes.push({ key: `event.metrics.${key}`, value: { doubleValue: value } });
    }

    if (input.body.event_details) {
      for (const [key, value] of Object.entries(input.body.event_details)) {
        if (typeof value === "string") {
          attributes.push({ key: `event.details.${key}`, value: { stringValue: value } });
        } else if (typeof value === "number") {
          attributes.push({ key: `event.details.${key}`, value: { doubleValue: value } });
        } else if (value != null) {
          attributes.push({ key: `event.details.${key}`, value: { stringValue: String(value) } });
        }
      }
    }

    return attributes;
  }
}
