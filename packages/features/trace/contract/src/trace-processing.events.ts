import {
  isSpanReceivedEvent,
  spanReceivedEventDataSchema,
  spanReceivedEventMetadataSchema,
  spanReceivedEventSchema,
  type SpanReceivedEvent,
  type SpanReceivedEventData,
  type SpanReceivedEventMetadata,
} from "./trace-ingress.events";
import { piiRedactionLevelSchema } from "./trace-ingress.commands";
import { z } from "zod";
import {
  ANNOTATION_ADDED_EVENT_TYPE,
  ANNOTATION_REMOVED_EVENT_TYPE,
  ANNOTATIONS_BULK_SYNCED_EVENT_TYPE,
  LOG_CONTRIBUTED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  METRIC_DATA_POINT_CORRELATED_EVENT_TYPE,
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECORDED_EVENT_TYPE,
  SPAN_REFERENCED_PAYLOAD_TYPE,
  SPAN_REFERENCED_PAYLOAD_VERSION_LATEST,
  SPAN_REFERENCED_PAYLOAD_VERSIONS,
  TOPIC_ASSIGNED_EVENT_TYPE,
  TRACE_NAME_CHANGED_EVENT_TYPE,
  TRACE_NAME_MAX_LENGTH,
  TRACE_NAME_MIN_LENGTH,
} from "./trace.constants";
import { fixed64Schema } from "./trace.otlp";
import { metricCorrelationFields } from "./trace-metric-correlation";
import { recordTraceSpanEventDataSchema } from "./trace-processing.commands";
import { logTraceContributionSchema } from "./trace-log-contribution";

export {
  isSpanReceivedEvent,
  spanReceivedEventDataSchema,
  spanReceivedEventMetadataSchema,
  spanReceivedEventSchema,
};
export type { SpanReceivedEvent, SpanReceivedEventData, SpanReceivedEventMetadata };

const aggregateTypeSchema = z.string().trim().min(1);
const tenantIdSchema = z
  .string()
  .trim()
  .min(1, "[SECURITY] TenantId must be a non-empty string for tenant isolation")
  .brand<"TenantId">();
const eventTypeSchema = z.string().trim().min(1);
const eventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();
const traceEventSchema = z.object({
  id: z.string(),
  aggregateId: z.string(),
  aggregateType: aggregateTypeSchema,
  tenantId: tenantIdSchema,
  createdAt: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
  type: eventTypeSchema,
  version: z.string().date(),
  data: z.unknown(),
  metadata: eventMetadataSchema.optional(),
  idempotencyKey: z.string().optional(),
});

/**
 * Zod schema for EventMetadataBase.
 * Base metadata that all events can have.
 */
const eventMetadataBaseSchema = eventMetadataSchema;

export const spanRecordedEventSchema = traceEventSchema.extend({
  type: z.literal(SPAN_RECORDED_EVENT_TYPE),
  data: recordTraceSpanEventDataSchema,
  metadata: eventMetadataBaseSchema,
});

export type SpanRecordedEvent = z.infer<typeof spanRecordedEventSchema>;

export function isSpanRecordedEvent(event: TraceProcessingEvent): event is SpanRecordedEvent {
  return event.type === SPAN_RECORDED_EVENT_TYPE;
}

/**
 * The claim-check twin of `span_received` (ADR-069): the routing seam stages
 * this in place of the full event for a subscriber that opted in, and the
 * handler reads the span back from its canonical store.
 *
 * This is a STAGED QUEUE PAYLOAD, not an event — a plain versioned DTO owned
 * by the staging lane. It is never appended to the event log (the durable
 * event stays `span_received`); see the constant's docblock for the
 * versioning contract. Its fields mirror the event envelope field-for-field
 * (same names, same validators) so the wire shape is byte-identical to what
 * earlier builds staged and parsed.
 */
export const spanReferencedPayloadDataSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  /** The raw wire span name, mirrored so gates and debugging never need the store. */
  spanName: z.string(),
  /**
   * The span's own start, epoch ms, parsed off the wire `startTimeUnixNano`,
   * or null when the wire value is unparseable.
   *
   * Descriptive only. Resolution is a durable event-store lookup keyed by
   * `(tenantId, aggregateType, aggregateId, id)`, so a null here costs the
   * reader nothing — there is no partition window to center and nothing to go
   * blind. A reader that still resolves through a time-windowed span store may
   * use this as a hint, but it is not the reference's key and a null is an
   * ordinary value, not a degraded one.
   */
  startTimeUnixMs: z.number().nullable(),
});

export const spanReferencedPayloadSchema = z.object({
  id: z.string(),
  aggregateId: z.string(),
  aggregateType: aggregateTypeSchema,
  tenantId: tenantIdSchema,
  createdAt: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
  type: z.literal(SPAN_REFERENCED_PAYLOAD_TYPE),
  version: z.enum(SPAN_REFERENCED_PAYLOAD_VERSIONS),
  data: spanReferencedPayloadDataSchema,
  metadata: eventMetadataBaseSchema.optional(),
  idempotencyKey: z.string().optional(),
});

export type SpanReferencedPayloadData = z.infer<typeof spanReferencedPayloadDataSchema>;
export type SpanReferencedPayload = z.infer<typeof spanReferencedPayloadSchema>;

/**
 * Discriminate-then-validate read of a staged payload.
 *
 * Returns `null` when the payload does not even claim to be a span reference
 * (the caller falls through to its full-event path). But once the payload
 * claims the type, a shape or version this build cannot read THROWS into the
 * queue's retry — falling through would let a mixed-deploy job be mistaken
 * for another kind of payload and silently no-op.
 */
export function parseSpanReferencedPayload(value: unknown): SpanReferencedPayload | null {
  const candidate = z.object({ type: z.unknown() }).safeParse(value);
  if (!candidate.success || candidate.data.type !== SPAN_REFERENCED_PAYLOAD_TYPE) {
    return null;
  }
  return spanReferencedPayloadSchema.parse(value);
}

/**
 * Builds the staged reference for a matched `span_received` event, mirroring
 * the envelope fields the scheduler orders, groups, and dedups by (same id,
 * aggregate, tenant, occurredAt).
 *
 * Identity only, always. The reference names the durable event and never
 * carries the raw span: the resolving read is an event-store lookup keyed by
 * `(tenantId, aggregateType, aggregateId, id)`, and `span_received` carries
 * exactly one span, so that key alone identifies it. `spanId`, `spanName` and
 * `startTimeUnixMs` are descriptive — they let a gate or a log line skip the
 * store, and none of them is the key. There is therefore no shape of event
 * this function cannot reference, and no path on which a raw payload rides the
 * queue.
 *
 * Total at runtime, not merely against the type. This runs as an `enqueue`
 * hook on the shared routing seam, which has no retry, so a throw here would
 * permanently lose that subscriber's job (ADR-069). The schema types
 * `data.span` as present, but the value reaching this function is untrusted
 * wire data behind a cast, so every field is read defensively.
 */
export function makeSpanReferencedPayload(event: SpanReceivedEvent): SpanReferencedPayload {
  const span: Partial<SpanReceivedEvent["data"]["span"]> = event.data.span ?? {};
  const startTimeUnixMs = parseStartTimeUnixMs(span.startTimeUnixNano);
  return {
    id: event.id,
    version: SPAN_REFERENCED_PAYLOAD_VERSION_LATEST,
    aggregateId: event.aggregateId,
    aggregateType: event.aggregateType,
    tenantId: event.tenantId,
    createdAt: event.createdAt,
    occurredAt: event.occurredAt,
    type: SPAN_REFERENCED_PAYLOAD_TYPE,
    data: {
      traceId: String(event.aggregateId),
      spanId: span.spanId ?? "",
      spanName: span.name ?? "",
      startTimeUnixMs,
    },
    metadata: event.metadata,
  };
}

/**
 * ns→ms off the wire `startTimeUnixNano`, total: null on anything unparseable
 * or non-positive.
 *
 * Delegates to the pipeline's canonical normalizer rather than re-deriving the
 * shapes: `startTimeUnixNano` is a `Fixed64`, which off an OTLP/protobuf decode
 * is a `{low, high}` Long — `parseOtlpBody` decodes without
 * `toObject({longs: String})`, so the Long shape reaches here unchanged, and a
 * string/number-only parse silently read it as "no start". The normalizer
 * throws on an unrecognised shape; this seam must be TOTAL (ADR-069: a throw on
 * the retry-less routing path permanently loses the job), so the throw is
 * contained here and reported as null.
 *
 * Parsing a 19-digit ns value through a double loses sub-microsecond precision,
 * which is sub-millisecond after the divide — well inside what partition
 * windowing tolerates.
 */
function parseStartTimeUnixMs(value: unknown): number | null {
  const parsed = fixed64Schema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  const normalized = parsed.data;
  const nano =
    typeof normalized === "number"
      ? normalized
      : typeof normalized === "string"
        ? Number.parseInt(normalized, 10)
        : Number((BigInt(normalized.high) << 32n) | (BigInt(normalized.low) & 0xffffffffn));

  if (!Number.isFinite(nano) || nano <= 0) return null;
  return Math.floor(nano / 1e6);
}

/**
 * Zod schema for TopicAssignedEvent metadata.
 */
export const topicAssignedEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

/**
 * Zod schema for TopicAssignedEvent data.
 */
export const topicAssignedEventDataSchema = z.object({
  topicId: z.string().nullable(),
  topicName: z.string().nullable(),
  subtopicId: z.string().nullable(),
  subtopicName: z.string().nullable(),
  isIncremental: z.boolean(),
});

export const topicAssignedEventSchema = traceEventSchema.extend({
  type: z.literal(TOPIC_ASSIGNED_EVENT_TYPE),
  data: topicAssignedEventDataSchema,
  metadata: topicAssignedEventMetadataSchema,
});

export type TopicAssignedEventMetadata = z.infer<typeof topicAssignedEventMetadataSchema>;
export type TopicAssignedEventData = z.infer<typeof topicAssignedEventDataSchema>;
export type TopicAssignedEvent = z.infer<typeof topicAssignedEventSchema>;

/**
 * Type guard for TopicAssignedEvent.
 */
export function isTopicAssignedEvent(event: TraceProcessingEvent): event is TopicAssignedEvent {
  return event.type === TOPIC_ASSIGNED_EVENT_TYPE;
}

/**
 * Zod schema for LogRecordReceivedEvent metadata.
 */
export const logRecordReceivedEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

export const logRecordReceivedEventDataSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  timeUnixMs: z.number(),
  severityNumber: z.number(),
  severityText: z.string(),
  body: z.string(),
  attributes: z.record(z.string(), z.string()),
  resourceAttributes: z.record(z.string(), z.string()),
  scopeName: z.string(),
  scopeVersion: z.string().nullable(),
  piiRedactionLevel: piiRedactionLevelSchema,
});

export const logRecordReceivedEventSchema = traceEventSchema.extend({
  type: z.literal(LOG_RECORD_RECEIVED_EVENT_TYPE),
  data: logRecordReceivedEventDataSchema,
  metadata: logRecordReceivedEventMetadataSchema,
});

export type LogRecordReceivedEventData = z.infer<typeof logRecordReceivedEventDataSchema>;
export type LogRecordReceivedEvent = z.infer<typeof logRecordReceivedEventSchema>;

export function isLogRecordReceivedEvent(
  event: TraceProcessingEvent,
): event is LogRecordReceivedEvent {
  return event.type === LOG_RECORD_RECEIVED_EVENT_TYPE;
}

export const logContributedEventDataSchema = logTraceContributionSchema.omit({
  tenantId: true,
  occurredAt: true,
});

export const logContributedEventSchema = traceEventSchema.extend({
  type: z.literal(LOG_CONTRIBUTED_EVENT_TYPE),
  data: logContributedEventDataSchema,
  metadata: eventMetadataBaseSchema,
});

export type LogContributedEventData = z.infer<typeof logContributedEventDataSchema>;
export type LogContributedEvent = z.infer<typeof logContributedEventSchema>;

export function isLogContributedEvent(event: TraceProcessingEvent): event is LogContributedEvent {
  return event.type === LOG_CONTRIBUTED_EVENT_TYPE;
}

/**
 * A valid exemplar correlation is deliberately separate from the canonical
 * metric event. Only this trace-scoped event is visible to trace folds.
 */
export const metricDataPointCorrelatedEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

export const metricDataPointCorrelatedEventDataSchema = z.object(metricCorrelationFields);

export const metricDataPointCorrelatedEventSchema = traceEventSchema.extend({
  type: z.literal(METRIC_DATA_POINT_CORRELATED_EVENT_TYPE),
  data: metricDataPointCorrelatedEventDataSchema,
  metadata: metricDataPointCorrelatedEventMetadataSchema,
});

export type MetricDataPointCorrelatedEventData = z.infer<
  typeof metricDataPointCorrelatedEventDataSchema
>;
export type MetricDataPointCorrelatedEvent = z.infer<typeof metricDataPointCorrelatedEventSchema>;

export function isMetricDataPointCorrelatedEvent(
  event: TraceProcessingEvent,
): event is MetricDataPointCorrelatedEvent {
  return event.type === METRIC_DATA_POINT_CORRELATED_EVENT_TYPE;
}

/**
 * Zod schema for OriginResolvedEvent metadata.
 */
export const originResolvedEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

/**
 * Zod schema for OriginResolvedEvent data.
 */
export const originResolvedEventDataSchema = z.object({
  origin: z.string(),
  reason: z.string(),
});

export const originResolvedEventSchema = traceEventSchema.extend({
  type: z.literal(ORIGIN_RESOLVED_EVENT_TYPE),
  data: originResolvedEventDataSchema,
  metadata: originResolvedEventMetadataSchema,
});

export type OriginResolvedEventData = z.infer<typeof originResolvedEventDataSchema>;
export type OriginResolvedEvent = z.infer<typeof originResolvedEventSchema>;

/**
 * Type guard for OriginResolvedEvent.
 */
export function isOriginResolvedEvent(event: TraceProcessingEvent): event is OriginResolvedEvent {
  return event.type === ORIGIN_RESOLVED_EVENT_TYPE;
}

/**
 * Zod schema for AnnotationAddedEvent metadata.
 */
export const annotationAddedEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

/**
 * Zod schema for AnnotationAddedEvent data.
 */
export const annotationAddedEventDataSchema = z.object({
  traceId: z.string(),
  annotationId: z.string(),
});

export const annotationAddedEventSchema = traceEventSchema.extend({
  type: z.literal(ANNOTATION_ADDED_EVENT_TYPE),
  data: annotationAddedEventDataSchema,
  metadata: annotationAddedEventMetadataSchema,
});

export type AnnotationAddedEventData = z.infer<typeof annotationAddedEventDataSchema>;
export type AnnotationAddedEvent = z.infer<typeof annotationAddedEventSchema>;

/**
 * Type guard for AnnotationAddedEvent.
 */
export function isAnnotationAddedEvent(event: TraceProcessingEvent): event is AnnotationAddedEvent {
  return event.type === ANNOTATION_ADDED_EVENT_TYPE;
}

/**
 * Zod schema for AnnotationRemovedEvent metadata.
 */
export const annotationRemovedEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

/**
 * Zod schema for AnnotationRemovedEvent data.
 */
export const annotationRemovedEventDataSchema = z.object({
  traceId: z.string(),
  annotationId: z.string(),
});

export const annotationRemovedEventSchema = traceEventSchema.extend({
  type: z.literal(ANNOTATION_REMOVED_EVENT_TYPE),
  data: annotationRemovedEventDataSchema,
  metadata: annotationRemovedEventMetadataSchema,
});

export type AnnotationRemovedEventData = z.infer<typeof annotationRemovedEventDataSchema>;
export type AnnotationRemovedEvent = z.infer<typeof annotationRemovedEventSchema>;

/**
 * Type guard for AnnotationRemovedEvent.
 */
export function isAnnotationRemovedEvent(
  event: TraceProcessingEvent,
): event is AnnotationRemovedEvent {
  return event.type === ANNOTATION_REMOVED_EVENT_TYPE;
}

/**
 * Zod schema for AnnotationsBulkSyncedEvent metadata.
 */
export const annotationsBulkSyncedEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

/**
 * Zod schema for AnnotationsBulkSyncedEvent data.
 */
export const annotationsBulkSyncedEventDataSchema = z.object({
  traceId: z.string(),
  annotationIds: z.array(z.string()),
});

export const annotationsBulkSyncedEventSchema = traceEventSchema.extend({
  type: z.literal(ANNOTATIONS_BULK_SYNCED_EVENT_TYPE),
  data: annotationsBulkSyncedEventDataSchema,
  metadata: annotationsBulkSyncedEventMetadataSchema,
});

export type AnnotationsBulkSyncedEventData = z.infer<typeof annotationsBulkSyncedEventDataSchema>;
export type AnnotationsBulkSyncedEvent = z.infer<typeof annotationsBulkSyncedEventSchema>;

/**
 * Type guard for AnnotationsBulkSyncedEvent.
 */
export function isAnnotationsBulkSyncedEvent(
  event: TraceProcessingEvent,
): event is AnnotationsBulkSyncedEvent {
  return event.type === ANNOTATIONS_BULK_SYNCED_EVENT_TYPE;
}

/**
 * Zod schema for TraceNameChangedEvent metadata.
 */
export const traceNameChangedEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

/**
 * Zod schema for TraceNameChangedEvent data.
 *
 * The trim+length bounds are domain rules — the same shape the
 * ChangeTraceName command's input schema enforces. Encoding them on the
 * event itself means a replay against bad historical data still rejects
 * via Zod instead of silently overriding with a 4 KB blob.
 */
export const traceNameChangedEventDataSchema = z.object({
  traceId: z.string(),
  /** New name. Trim happens at the command boundary; the event stores the canonical form. */
  newName: z.string().min(TRACE_NAME_MIN_LENGTH).max(TRACE_NAME_MAX_LENGTH),
  /** User who made the change, if available — for audit + UI attribution. */
  changedByUserId: z.string().nullable(),
});

export const traceNameChangedEventSchema = traceEventSchema.extend({
  type: z.literal(TRACE_NAME_CHANGED_EVENT_TYPE),
  data: traceNameChangedEventDataSchema,
  metadata: traceNameChangedEventMetadataSchema,
});

export type TraceNameChangedEventData = z.infer<typeof traceNameChangedEventDataSchema>;
export type TraceNameChangedEvent = z.infer<typeof traceNameChangedEventSchema>;

/**
 * Type guard for TraceNameChangedEvent.
 */
export function isTraceNameChangedEvent(
  event: TraceProcessingEvent,
): event is TraceNameChangedEvent {
  return event.type === TRACE_NAME_CHANGED_EVENT_TYPE;
}

/**
 * Union of all trace processing event types.
 */
export type TraceProcessingEvent =
  | SpanReceivedEvent
  | SpanRecordedEvent
  | TopicAssignedEvent
  | LogRecordReceivedEvent
  | LogContributedEvent
  | MetricDataPointCorrelatedEvent
  | OriginResolvedEvent
  | AnnotationAddedEvent
  | AnnotationRemovedEvent
  | AnnotationsBulkSyncedEvent
  | TraceNameChangedEvent;
