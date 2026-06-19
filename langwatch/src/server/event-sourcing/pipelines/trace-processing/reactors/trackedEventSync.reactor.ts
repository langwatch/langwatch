import crypto from "node:crypto";
import {
  predefinedEventTypes,
  predefinedEventsSchemas,
} from "~/server/app-layer/events/predefinedEvents.schema";
import type { TrackEventRESTParamsValidator } from "~/server/tracer/types";
import { createLogger } from "../../../../../utils/logger/server";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import { STALE_TRACE_THRESHOLD_MS } from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";
import { isSpanReceivedEvent } from "../schemas/events";
import type { OtlpSpan } from "../schemas/otlp";

const logger = createLogger(
  "langwatch:trace-processing:tracked-event-sync-reactor",
);

/**
 * Span event name the SDKs emit when a developer records live feedback (a
 * thumbs up/down, a rating) against an in-flight span. Mirrors
 * `langwatch.evaluation.custom` but feeds the tracked-event path instead of
 * the evaluation path.
 */
const FEEDBACK_EVENT_NAME = "langwatch.event";

const EVENT_TYPE_KEY = "event.type";
const METRICS_PREFIX = "event.metrics.";
const DETAILS_PREFIX = "event.details.";

/**
 * One reconstructed tracked-event payload, shaped like the REST
 * `POST /api/events/track` body so it can flow through the same ingestion path.
 */
export interface ReconstructedTrackedEvent {
  event_type: string;
  metrics: Record<string, number>;
  event_details: Record<string, string>;
}

export interface TrackedEventSyncReactorDeps {
  /**
   * Records a tracked event through the same path as the REST
   * `POST /api/events/track` handler (see `recordTrackedEventSpan`). Wired in
   * the composition root so the reactor stays free of the app singleton.
   */
  recordTrackedEvent: (params: {
    tenantId: string;
    body: TrackEventRESTParamsValidator;
    eventId: string;
  }) => Promise<void>;
}

/**
 * Deterministic event id so a replayed span re-records the same tracked event
 * rather than duplicating it. Keyed on (trace, span, event type) — a span may
 * carry at most one feedback event per type.
 */
function deterministicEventId({
  traceId,
  spanId,
  eventType,
}: {
  traceId: string;
  spanId: string;
  eventType: string;
}): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${traceId}:${spanId}:${eventType}`)
    .digest("hex");
  return `event_sha_${hash.slice(0, 32)}`;
}

/**
 * Reconstructs tracked-event payloads from a span's `langwatch.event` events.
 *
 * Each event carries `event.type` (string), `event.metrics.<key>` (double) and
 * `event.details.<key>` (string) attributes; this rebuilds the
 * `{ event_type, metrics, event_details }` shape the track-event path expects.
 * Events without an `event.type` are skipped.
 */
export function extractTrackedEventsFromSpan(
  span: OtlpSpan,
): ReconstructedTrackedEvent[] {
  const events: ReconstructedTrackedEvent[] = [];

  for (const event of span.events ?? []) {
    if (event.name !== FEEDBACK_EVENT_NAME) continue;

    let eventType: string | undefined;
    const metrics: Record<string, number> = {};
    const eventDetails: Record<string, string> = {};

    for (const attr of event.attributes) {
      const value = attr.value;
      if (attr.key === EVENT_TYPE_KEY) {
        if (value && "stringValue" in value && typeof value.stringValue === "string") {
          eventType = value.stringValue;
        }
        continue;
      }
      if (attr.key.startsWith(METRICS_PREFIX)) {
        const metricKey = attr.key.slice(METRICS_PREFIX.length);
        const raw =
          value && "doubleValue" in value ? value.doubleValue : undefined;
        const num =
          typeof raw === "number"
            ? raw
            : typeof raw === "string"
              ? Number(raw)
              : NaN;
        if (metricKey.length > 0 && Number.isFinite(num)) {
          metrics[metricKey] = num;
        }
        continue;
      }
      if (attr.key.startsWith(DETAILS_PREFIX)) {
        const detailKey = attr.key.slice(DETAILS_PREFIX.length);
        if (
          detailKey.length > 0 &&
          value &&
          "stringValue" in value &&
          typeof value.stringValue === "string"
        ) {
          eventDetails[detailKey] = value.stringValue;
        }
        continue;
      }
    }

    if (eventType === undefined || eventType.length === 0) continue;

    events.push({ event_type: eventType, metrics, event_details: eventDetails });
  }

  return events;
}

/**
 * Cheap presence check — no parsing. Runs on the projection hot path with
 * attacker-supplied span payloads, so it only looks for a `langwatch.event`
 * event carrying an `event.type` string; full reconstruction and validation
 * stay in handle() off the hot path.
 */
function spanHasFeedbackEvents(span: OtlpSpan): boolean {
  return (span.events ?? []).some(
    (event) =>
      event.name === FEEDBACK_EVENT_NAME &&
      event.attributes.some(
        (attr) =>
          attr.key === EVENT_TYPE_KEY &&
          attr.value !== undefined &&
          "stringValue" in attr.value &&
          typeof attr.value.stringValue === "string" &&
          attr.value.stringValue.length > 0,
      ),
  );
}

/**
 * Pure relevance guard shared by shouldReact (pre-enqueue) and handle: only
 * recent span events carrying `langwatch.event` feedback need this reactor.
 */
function hasSyncableFeedback(event: TraceProcessingEvent): boolean {
  if (!isSpanReceivedEvent(event)) return false;
  if (event.occurredAt < Date.now() - STALE_TRACE_THRESHOLD_MS) return false;
  return spanHasFeedbackEvents(event.data.span);
}

/**
 * Validates a reconstructed event against the predefined event-type schemas
 * (thumbs_up_down, selected_text, waited_to_finish). Custom event types pass
 * through unchecked, matching the REST handler. Returns false for malformed
 * predefined events so they are dropped rather than ingested.
 */
function isValidTrackedEvent(
  event: ReconstructedTrackedEvent,
  traceId: string,
): boolean {
  if (
    !predefinedEventTypes.includes(
      event.event_type as (typeof predefinedEventTypes)[number],
    )
  ) {
    return true;
  }

  return predefinedEventsSchemas.safeParse({
    trace_id: traceId,
    event_type: event.event_type,
    metrics: event.metrics,
    event_details: event.event_details,
  }).success;
}

/**
 * Reactor that turns live span feedback into tracked events.
 *
 * Reads `langwatch.event` events directly from each SpanReceivedEvent's OTLP
 * span, reconstructs the `{ event_type, metrics, event_details }` payload, and
 * records each through the same path as `POST /api/events/track` so an
 * SDK-emitted thumbs_up_down lands identically to a REST call. Uses
 * deterministic IDs for idempotency on retries; malformed predefined events
 * are logged and skipped (mirrors customEvaluationSync's parse-failure path).
 */
export function createTrackedEventSyncReactor(
  deps: TrackedEventSyncReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "trackedEventSync",
    shouldReact: (event) => hasSyncableFeedback(event),
    options: {
      makeJobId: (payload) =>
        `tracked-event-sync:${payload.event.tenantId}:${payload.event.aggregateId}:${payload.event.id}`,
      ttl: 30_000,
      delay: 5_000,
    },

    async handle(
      event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      if (!isSpanReceivedEvent(event)) return;
      if (!hasSyncableFeedback(event)) return;

      const { tenantId, aggregateId: traceId } = context;
      const spanId = event.data.span.spanId;

      const trackedEvents = extractTrackedEventsFromSpan(event.data.span);
      if (trackedEvents.length === 0) return;

      const errors: Error[] = [];

      for (const trackedEvent of trackedEvents) {
        if (!isValidTrackedEvent(trackedEvent, traceId)) {
          logger.warn(
            { tenantId, traceId, eventType: trackedEvent.event_type },
            "Discarding malformed langwatch.event feedback (schema validation failed)",
          );
          continue;
        }

        const eventId = deterministicEventId({
          traceId,
          spanId,
          eventType: trackedEvent.event_type,
        });

        try {
          await deps.recordTrackedEvent({
            tenantId,
            eventId,
            body: {
              trace_id: traceId,
              event_type: trackedEvent.event_type,
              metrics: trackedEvent.metrics,
              event_details: trackedEvent.event_details,
              timestamp: event.occurredAt,
            },
          });
        } catch (error) {
          logger.error(
            {
              tenantId,
              traceId,
              eventType: trackedEvent.event_type,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to record tracked event from span feedback",
          );
          errors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }

      if (errors.length > 0) {
        throw errors[0];
      }
    },
  };
}
