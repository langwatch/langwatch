import { createHash } from "node:crypto";
import { SpanStatusCode } from "@opentelemetry/api";
import { ESpanKind } from "@opentelemetry/otlp-transformer-next/build/esm/trace/internal-types.js";
import { generate } from "@langwatch/ksuid";
import {
  DEFAULT_PII_REDACTION_LEVEL,
  TRACK_EVENT_SPAN_NAME,
  type TrackEventRESTParamsValidator,
} from "@langwatch/trace-contract";
import type { TraceSpanCollectionService } from "./trace-ingestion.service.ts";
import { nowInstant } from "@langwatch/time";

/**
 * The ksuid prefix every tracked-event id ever written carries. A literal
 * rather than an import: not published by any contract package, and part
 * of ids already in customers' databases, so pinned here and in the test.
 */
const TRACKED_EVENT_KSUID_RESOURCE = "trackedevent";

/** Tracked events become synthetic spans with deterministic IDs to collapse
 * retries. Attributes duplicated for summary projection and customer timeline. */
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
   * The span id both paths must agree on. Sixteen hex characters because
   * that is an OTLP span id; a digest rather than random because
   * idempotency here is the difference between one rating and two.
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
    const timestampMs = body.timestamp ?? nowInstant().epochMilliseconds;
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

  /** OTLP attribute encoding: metrics as doubles, details stringified
   * (null/undefined omitted to avoid ambiguity). */
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
