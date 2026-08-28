import crypto from "node:crypto";
import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  predefinedEventsSchemas,
  predefinedEventTypes,
} from "~/server/app-layer/events/predefinedEvents.schema";
import { TRACK_EVENT_SPAN_NAME } from "~/server/tracer/constants";
import {
  type TrackEventRESTParamsValidator,
  trackEventRESTParamsValidatorSchema,
} from "@langwatch/trace-contract";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { STALE_TRACE_THRESHOLD_MS } from "@langwatch/trace-contract";
import { isSpanReceivedEvent, type TraceProcessingEvent } from "@langwatch/trace-contract";
import type { OtlpAnyValue, OtlpSpan } from "@langwatch/trace-contract";

const logger = createLogger("langwatch:trace-processing:tracked-event-sync");

export const TRACKED_EVENT_SYNC_DELAY_MS = 5_000;
export const TRACKED_EVENT_SYNC_DEDUP_TTL_MS = 30_000;

export function trackedEventSyncDedupId(event: TraceProcessingEvent): string {
  return `${event.tenantId}:${event.aggregateId}:${event.id}`;
}

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
 * `POST /api/events/track` body so it can flow through the same ingestion path,
 * plus the occurrence ordinal that separates two feedback events of the same
 * type on one span.
 */
export interface ReconstructedTrackedEvent {
  event_type: string;
  metrics: Record<string, number>;
  event_details: Record<string, string>;
  /**
   * Index of the source event within the span's own `events` list. That list is
   * fixed for a given span, so the ordinal is stable across replays — unlike a
   * running counter over the reconstructed subset, which would shift whenever a
   * preceding event started or stopped passing reconstruction.
   */
  occurrenceIndex: number;
}

/**
 * An event type is recordable only when it is present, non-empty, and not the
 * envelope's own wire name. `recordTrackedEventSpan` emits a span event named
 * after the recorded `event_type` and always stamps an `event.type` attribute,
 * so a tracked event typed `langwatch.event` would produce a span that matches
 * this subscriber's own predicate — a self-feeding amplification loop that dedup
 * cannot break, because every hop mints a fresh span id.
 */
function isRecordableEventType(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value !== FEEDBACK_EVENT_NAME;
}

export interface TrackedEventSyncSubscriberDeps {
  /**
   * Records a tracked event through the same path as the REST
   * `POST /api/events/track` handler (see `recordTrackedEventSpan`). Wired in
   * the composition root so the subscriber stays free of the app singleton.
   */
  recordTrackedEvent: (params: {
    tenantId: string;
    body: TrackEventRESTParamsValidator;
    eventId: string;
  }) => Promise<void>;
}

/**
 * Deterministic event id so a replayed span re-records the same tracked event
 * rather than duplicating it. Keyed on (trace, span, event type, occurrence
 * ordinal): nothing stops a span carrying two `langwatch.event` entries of the
 * same type, and without the ordinal both would hash to one id, so idempotent
 * recording would collapse them into a single tracked event. The ordinal is the
 * event's index within the span's own event list, which is fixed for a given
 * span and therefore identical on every replay.
 */
function deterministicEventId({
  traceId,
  spanId,
  eventType,
  occurrenceIndex,
}: {
  traceId: string;
  spanId: string;
  eventType: string;
  occurrenceIndex: number;
}): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${traceId}:${spanId}:${eventType}:${occurrenceIndex}`)
    .digest("hex");
  return `event_sha_${hash.slice(0, 32)}`;
}

/**
 * Reads a metric attribute as a number.
 *
 * OTLP carries a numeric attribute as either `doubleValue` or `intValue`, and an
 * `intValue` reaches us as a number, a decimal string, or a protobuf Long
 * (`{ low, high }`) depending on the transport. An SDK recording an integer
 * `event.metrics.vote` sends `intValue`, so reading `doubleValue` alone would
 * drop the vote and then fail the predefined `thumbs_up_down` schema, discarding
 * valid feedback.
 */
function readMetricValue(value: OtlpAnyValue | undefined): number | undefined {
  const raw = value?.doubleValue ?? value?.intValue;
  if (raw === null || raw === undefined) return undefined;

  const num =
    typeof raw === "object"
      ? Number((BigInt(raw.high) << 32n) | (BigInt(raw.low) & 0xffffffffn))
      : Number(raw);

  return Number.isFinite(num) ? num : undefined;
}

/**
 * Reads an attribute as a string, returning undefined for any other OTLP
 * encoding. `event.type` and every `event.details.<key>` are string-only, so an
 * attribute arriving as an int or a bool is dropped rather than coerced.
 */
function readStringValue(value: OtlpAnyValue | undefined): string | undefined {
  if (value && "stringValue" in value && typeof value.stringValue === "string") {
    return value.stringValue;
  }
  return undefined;
}

type OtlpSpanEvent = NonNullable<OtlpSpan["events"]>[number];

/**
 * Records one `event.metrics.<key>` attribute onto the draft's metric map.
 * A prefix with nothing after it, or a value that is not a finite number, is
 * skipped.
 */
function collectMetricAttribute({
  metrics,
  key,
  value,
}: {
  metrics: Record<string, number>;
  key: string;
  value: OtlpAnyValue | undefined;
}): void {
  const metricKey = key.slice(METRICS_PREFIX.length);
  const num = readMetricValue(value);
  if (metricKey.length > 0 && num !== undefined) {
    metrics[metricKey] = num;
  }
}

/**
 * Records one `event.details.<key>` attribute onto the draft's detail map.
 * A prefix with nothing after it, or a non-string value, is skipped.
 */
function collectDetailAttribute({
  eventDetails,
  key,
  value,
}: {
  eventDetails: Record<string, string>;
  key: string;
  value: OtlpAnyValue | undefined;
}): void {
  const detailKey = key.slice(DETAILS_PREFIX.length);
  const detailValue = readStringValue(value);
  if (detailKey.length > 0 && detailValue !== undefined) {
    eventDetails[detailKey] = detailValue;
  }
}

/**
 * Rebuilds the `{ event_type, metrics, event_details }` payload from one
 * `langwatch.event` span event's attributes. Returns undefined when the event
 * carries no usable `event.type`, so the caller drops it.
 */
function reconstructTrackedEvent({
  event,
  occurrenceIndex,
}: {
  event: OtlpSpanEvent;
  occurrenceIndex: number;
}): ReconstructedTrackedEvent | undefined {
  let eventType: string | undefined;
  const metrics: Record<string, number> = {};
  const eventDetails: Record<string, string> = {};

  for (const attr of event.attributes) {
    const value = attr.value;
    if (attr.key === EVENT_TYPE_KEY) {
      eventType = readStringValue(value) ?? eventType;
      continue;
    }
    if (attr.key.startsWith(METRICS_PREFIX)) {
      collectMetricAttribute({ metrics, key: attr.key, value });
      continue;
    }
    if (attr.key.startsWith(DETAILS_PREFIX)) {
      collectDetailAttribute({ eventDetails, key: attr.key, value });
    }
  }

  if (!isRecordableEventType(eventType)) return undefined;

  return {
    event_type: eventType,
    metrics,
    event_details: eventDetails,
    occurrenceIndex,
  };
}

/**
 * Reconstructs tracked-event payloads from a span's `langwatch.event` events.
 *
 * Each event carries `event.type` (string), `event.metrics.<key>` (double or
 * int) and `event.details.<key>` (string) attributes; this rebuilds the
 * `{ event_type, metrics, event_details }` shape the track-event path expects.
 * Events without an `event.type`, and events reserving the envelope's own name
 * as their type, are skipped. Spans this path emitted itself are never
 * reconstructed at all.
 */
export function extractTrackedEventsFromSpan(span: OtlpSpan): ReconstructedTrackedEvent[] {
  const events: ReconstructedTrackedEvent[] = [];

  if (span.name === TRACK_EVENT_SPAN_NAME) return events;

  for (const [occurrenceIndex, event] of (span.events ?? []).entries()) {
    if (event.name !== FEEDBACK_EVENT_NAME) continue;

    const reconstructed = reconstructTrackedEvent({ event, occurrenceIndex });
    if (reconstructed !== undefined) events.push(reconstructed);
  }

  return events;
}

/**
 * Cheap presence check — no parsing. Runs on the projection hot path with
 * attacker-supplied span payloads, so it only looks for a `langwatch.event`
 * event carrying a recordable `event.type` string; full reconstruction and
 * validation stay in handle() off the hot path.
 *
 * Spans named `TRACK_EVENT_SPAN_NAME` are this subscriber's own output, re-ingested
 * through the trace-processing pipeline by `recordTrackedEventSpan`. Skipping
 * them by name is what stops the subscriber reacting to itself, whatever event type
 * the caller supplied.
 */
function spanHasFeedbackEvents(span: OtlpSpan): boolean {
  if (span.name === TRACK_EVENT_SPAN_NAME) return false;

  return (span.events ?? []).some(
    (event) =>
      event.name === FEEDBACK_EVENT_NAME &&
      event.attributes.some(
        (attr) =>
          attr.key === EVENT_TYPE_KEY &&
          attr.value !== undefined &&
          "stringValue" in attr.value &&
          isRecordableEventType(attr.value.stringValue),
      ),
  );
}

/**
 * Pure relevance guard shared by shouldDispatch (pre-enqueue) and handle: only
 * recent span events carrying `langwatch.event` feedback need this subscriber.
 */
export function hasSyncableFeedback(event: TraceProcessingEvent): boolean {
  if (!isSpanReceivedEvent(event)) return false;
  if (event.occurredAt < Date.now() - STALE_TRACE_THRESHOLD_MS) return false;
  return spanHasFeedbackEvents(event.data.span);
}

/**
 * Validates a reconstructed event the way the REST `POST /api/events/track`
 * handler does: every payload is parsed with
 * `trackEventRESTParamsValidatorSchema` first, and a predefined event type
 * (thumbs_up_down, selected_text, waited_to_finish) is then additionally parsed
 * with `predefinedEventsSchemas`. Custom event types clear the base schema only,
 * exactly as they do over REST. Returns false for anything that fails either
 * check so it is dropped rather than ingested.
 */
function isValidTrackedEvent({
  event,
  traceId,
}: {
  event: ReconstructedTrackedEvent;
  traceId: string;
}): boolean {
  const payload = {
    trace_id: traceId,
    event_type: event.event_type,
    metrics: event.metrics,
    event_details: event.event_details,
  };

  if (!trackEventRESTParamsValidatorSchema.safeParse(payload).success) {
    return false;
  }

  if (!predefinedEventTypes.includes(event.event_type as (typeof predefinedEventTypes)[number])) {
    return true;
  }

  return predefinedEventsSchemas.safeParse(payload).success;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Validates one reconstructed event and records it. Returns the failure instead
 * of throwing it so the caller can finish the remaining events first: every
 * failure is logged here, and the caller rethrows the first so the framework
 * retries the whole span. An event that fails validation is logged and dropped,
 * which is not a failure — it returns undefined.
 */
async function recordReconstructedEvent({
  deps,
  trackedEvent,
  tenantId,
  traceId,
  spanId,
  timestamp,
}: {
  deps: TrackedEventSyncSubscriberDeps;
  trackedEvent: ReconstructedTrackedEvent;
  tenantId: string;
  traceId: string;
  spanId: string;
  timestamp: number;
}): Promise<Error | undefined> {
  if (!isValidTrackedEvent({ event: trackedEvent, traceId })) {
    logger.warn(
      { tenantId, traceId, eventType: trackedEvent.event_type },
      "Discarding malformed langwatch.event feedback (schema validation failed)",
    );
    return undefined;
  }

  const eventId = deterministicEventId({
    traceId,
    spanId,
    eventType: trackedEvent.event_type,
    occurrenceIndex: trackedEvent.occurrenceIndex,
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
        timestamp,
      },
    });
    return undefined;
  } catch (error) {
    const failure = toError(error);
    logger.error(
      {
        tenantId,
        traceId,
        eventType: trackedEvent.event_type,
        error: failure.message,
      },
      "Failed to record tracked event from span feedback",
    );
    return failure;
  }
}

/**
 * Reconstructs every tracked event on the span and records each one, collecting
 * the failures. The first failure is rethrown once the whole span has been
 * attempted, so the framework retries; deterministic event ids make that retry
 * idempotent for the events that already landed.
 */
async function syncTrackedEventsFromSpan({
  event,
  context,
  deps,
}: {
  event: TraceProcessingEvent;
  context: TriggerContext<TraceSummaryData>;
  deps: TrackedEventSyncSubscriberDeps;
}): Promise<void> {
  if (!isSpanReceivedEvent(event)) return;
  if (!hasSyncableFeedback(event)) return;

  const { tenantId, aggregateId: traceId } = context;
  const spanId = event.data.span.spanId;

  const trackedEvents = extractTrackedEventsFromSpan(event.data.span);
  if (trackedEvents.length === 0) return;

  const errors: Error[] = [];

  for (const trackedEvent of trackedEvents) {
    const failure = await recordReconstructedEvent({
      deps,
      trackedEvent,
      tenantId,
      traceId,
      spanId,
      timestamp: event.occurredAt,
    });
    if (failure !== undefined) errors.push(failure);
  }

  if (errors.length > 0) {
    throw errors[0];
  }
}

/**
 * Subscriber handler that turns live span feedback into tracked events.
 *
 * Reads `langwatch.event` events directly from each SpanReceivedEvent's OTLP
 * span, reconstructs the `{ event_type, metrics, event_details }` payload, and
 * records each through the same path as `POST /api/events/track` so an
 * SDK-emitted thumbs_up_down lands identically to a REST call. Uses
 * deterministic IDs for idempotency on retries; events that fail the same
 * validation the REST handler applies are logged and skipped (mirrors
 * customEvaluationSync's parse-failure path).
 */
export function createTrackedEventSyncHandler(
  deps: TrackedEventSyncSubscriberDeps,
): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
  return (event, context) => syncTrackedEventsFromSpan({ event, context, deps });
}
