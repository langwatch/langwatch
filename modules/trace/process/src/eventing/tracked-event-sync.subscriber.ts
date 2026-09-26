// Reconstructs feedback from span events: ID derived from span makes it
// idempotent; validation prevents recording invalid events.

import crypto from "node:crypto";

import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import {
  predefinedEventsSchemas,
  predefinedEventTypes,
  TRACK_EVENT_SPAN_NAME,
  type TrackEventRESTParamsValidator,
  trackEventRESTParamsValidatorSchema,
  STALE_TRACE_THRESHOLD_MS,
  isSpanReceivedEvent,
  type TraceProcessingEvent,
  type TraceSummaryData,
  type OtlpAnyValue,
  type OtlpSpan,
} from "@langwatch/trace-contract";

const logger = createLogger("langwatch:trace-processing:tracked-event-sync");

export const TRACKED_EVENT_SYNC_DELAY_MS = 5_000;
export const TRACKED_EVENT_SYNC_DEDUP_TTL_MS = 30_000;

/**
 * Span event name the SDKs emit for live feedback (thumbs up/down, a
 * rating) against an in-flight span. Mirrors `langwatch.evaluation.custom`
 * but feeds the tracked-event path instead.
 */
const FEEDBACK_EVENT_NAME = "langwatch.event";

const EVENT_TYPE_KEY = "event.type";
const METRICS_PREFIX = "event.metrics.";
const DETAILS_PREFIX = "event.details.";

/**
 * One reconstructed tracked-event payload, shaped like the REST
 * `POST /api/events/track` body for the same ingestion path, plus the
 * occurrence ordinal separating two same-type feedback events on one span.
 */
export interface ReconstructedTrackedEvent {
  event_type: string;
  metrics: Record<string, number>;
  event_details: Record<string, string>;
  /**
   * Index of the source event within the span's own `events` list — fixed
   * per span, so stable across replays, unlike a counter over the
   * reconstructed subset which shifts as preceding events pass or fail.
   */
  occurrenceIndex: number;
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

type OtlpSpanEvent = NonNullable<OtlpSpan["events"]>[number];

/**
 * Recordable only when present, non-empty, and not the envelope's own
 * wire name — a tracked event typed `langwatch.event` would otherwise
 * match this subscriber's own predicate, an amplification loop dedup can't break.
 */
function isRecordableEventType(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value !== FEEDBACK_EVENT_NAME;
}

// Deterministic ID with ordinal ensures replay is idempotent; prevents
// collapsing duplicate event types within a span.
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

// OTLP metrics come as doubleValue or intValue (the latter as
// number/string/Long); must read both to avoid dropping valid feedback.
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

// Cheap check for presence on hot path; skips self-generated spans to
// prevent subscriber reacting to itself.
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

// Mirrors REST handler validation: predefined event types get extra
// schema checks, custom types clear base schema only.
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

  if (!trackEventRESTParamsValidatorSchema.validate(payload)) {
    return false;
  }

  if (!predefinedEventTypes.includes(event.event_type as (typeof predefinedEventTypes)[number])) {
    return true;
  }

  return predefinedEventsSchemas.validate(payload);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Validates one reconstructed event and records it. Returns the failure
 * (rather than throwing) so the caller finishes remaining events first,
 * then rethrows the first so the framework retries the whole span.
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
 * Reconstructs every tracked event on the span, collecting failures. The
 * first is rethrown once the whole span is attempted, so the framework
 * retries; deterministic event ids make that retry idempotent.
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

export function trackedEventSyncDedupId(event: TraceProcessingEvent): string {
  return `${event.tenantId}:${event.aggregateId}:${event.id}`;
}

// Rebuilds { event_type, metrics, event_details } shape from span
// attributes; skips empty and reserved types.
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
 * Pure relevance guard shared by shouldDispatch (pre-enqueue) and handle: only
 * recent span events carrying `langwatch.event` feedback need this subscriber.
 */
export function hasSyncableFeedback(event: TraceProcessingEvent): boolean {
  if (!isSpanReceivedEvent(event)) return false;
  if (event.occurredAt < nowInstant().epochMilliseconds - STALE_TRACE_THRESHOLD_MS) return false;
  return spanHasFeedbackEvents(event.data.span);
}

// Reconstructs and records span feedback identically to POST /api/events/track;
// deterministic IDs ensure idempotency on retries.
export function createTrackedEventSyncHandler(
  deps: TrackedEventSyncSubscriberDeps,
): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
  return (event, context) => syncTrackedEventsFromSpan({ event, context, deps });
}
