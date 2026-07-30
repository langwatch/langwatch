import { z } from "zod";

import { EventSchema } from "../../../domain/types";
import { logTraceContributionSchema } from "../../log-processing/schemas/logRecord";
import { TraceRequestUtils } from "../utils/traceRequest.utils";
import { piiRedactionLevelSchema } from "./commands";
import {
  ANNOTATION_ADDED_EVENT_TYPE,
  ANNOTATION_ADDED_EVENT_VERSIONS,
  ANNOTATION_REMOVED_EVENT_TYPE,
  ANNOTATION_REMOVED_EVENT_VERSIONS,
  ANNOTATIONS_BULK_SYNCED_EVENT_TYPE,
  ANNOTATIONS_BULK_SYNCED_EVENT_VERSIONS,
  LOG_CONTRIBUTED_EVENT_TYPE,
  LOG_CONTRIBUTED_EVENT_VERSIONS,
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_VERSIONS,
  METRIC_DATA_POINT_CORRELATED_EVENT_TYPE,
  METRIC_DATA_POINT_CORRELATED_EVENT_VERSIONS,
  ORIGIN_RESOLVED_EVENT_TYPE,
  ORIGIN_RESOLVED_EVENT_VERSIONS,
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSIONS,
  SPAN_REFERENCED_EVENT_TYPE,
  SPAN_REFERENCED_EVENT_VERSION_LATEST,
  SPAN_REFERENCED_EVENT_VERSIONS,
  TOPIC_ASSIGNED_EVENT_TYPE,
  TOPIC_ASSIGNED_EVENT_VERSIONS,
  TRACE_NAME_CHANGED_EVENT_TYPE,
  TRACE_NAME_CHANGED_EVENT_VERSIONS,
  TRACE_NAME_MAX_LENGTH,
  TRACE_NAME_MIN_LENGTH,
} from "./constants";
import { metricCorrelationFields } from "./metricCorrelationFields";
import { instrumentationScopeSchema, resourceSchema, spanSchema } from "./otlp";

/**
 * Zod schema for EventMetadataBase.
 * Base metadata that all events can have.
 */
const eventMetadataBaseSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough(); // Allow additional properties via index signature

const spanReceivedEventMetadataSchema = eventMetadataBaseSchema.extend({
  spanId: z.string(),
  traceId: z.string(),
});

const spanReceivedEventDataSchema = z.object({
  span: spanSchema,
  resource: resourceSchema.nullable(),
  instrumentationScope: instrumentationScopeSchema.nullable(),
  piiRedactionLevel: piiRedactionLevelSchema,
});

export const spanReceivedEventSchema = EventSchema.extend({
  type: z.literal(SPAN_RECEIVED_EVENT_TYPE),
  version: z.enum(SPAN_RECEIVED_EVENT_VERSIONS),
  data: spanReceivedEventDataSchema,
  metadata: spanReceivedEventMetadataSchema,
});

export type SpanReceivedEvent = z.infer<typeof spanReceivedEventSchema>;

/**
 * Type guard for SpanReceivedEvent.
 */
export function isSpanReceivedEvent(
  event: TraceProcessingEvent,
): event is SpanReceivedEvent {
  return event.type === SPAN_RECEIVED_EVENT_TYPE;
}

/**
 * The claim-check twin of `span_received` (ADR-098): the routing seam stages
 * this in place of the full event for a subscriber that opted in, and the
 * handler reads the span back from its canonical store. Never appended to the
 * event log — see the constant's docblock for the versioning contract.
 */
const spanReferencedEventDataSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  /** The raw wire span name, mirrored so gates and debugging never need the store. */
  spanName: z.string(),
  /**
   * The span's own start, epoch ms, parsed off the wire `startTimeUnixNano`.
   * The resolution read centers its partition window here: the stored row's
   * StartTime IS this value, so the read stays a pruned point-read no matter
   * how long the span ran or how late it exported — `occurredAt` is ingest
   * time, which trails a long-lived span's start by the span's whole
   * duration, and a fixed window around it goes permanently blind past that.
   * Nullable for forward compatibility only — **the current producer never
   * emits null.** `makeSpanReferencedEvent` stages the WHOLE event instead
   * when it cannot parse a start, precisely because an `occurredAt`-centered
   * window is the permanently-blind case described above. So the reader's
   * `?? occurredAt` fallback is a total-function backstop for a shape only a
   * future producer could send, not a live path; do not reason about it as
   * one.
   */
  startTimeUnixMs: z.number().nullable(),
});

const spanReferencedEventSchema = EventSchema.extend({
  type: z.literal(SPAN_REFERENCED_EVENT_TYPE),
  version: z.enum(SPAN_REFERENCED_EVENT_VERSIONS),
  data: spanReferencedEventDataSchema,
});

type SpanReferencedEvent = z.infer<typeof spanReferencedEventSchema>;

/**
 * Discriminate-then-validate read of a staged payload.
 *
 * Returns `null` when the payload does not even claim to be a span reference
 * (the caller falls through to its full-event path). But once the payload
 * claims the type, a shape or version this build cannot read THROWS into the
 * queue's retry — falling through would let a mixed-deploy job be mistaken
 * for another kind of payload and silently no-op.
 */
export function parseSpanReferencedEvent(
  value: unknown,
): SpanReferencedEvent | null {
  if (typeof value !== "object" || value === null) return null;
  if ((value as { type?: unknown }).type !== SPAN_REFERENCED_EVENT_TYPE) {
    return null;
  }
  return spanReferencedEventSchema.parse(value);
}

/**
 * Builds the staged reference for a matched `span_received` event, mirroring
 * the envelope fields the scheduler orders, groups, and dedups by (same id,
 * aggregate, tenant, occurredAt). An event missing the identity a reference
 * needs stages the full event unchanged instead — the pre-reference behavior,
 * never a reference that could not resolve.
 *
 * Total at runtime, not merely against the type. This runs as an `enqueue`
 * hook on the shared routing seam, which has no retry, so a throw here would
 * permanently lose that subscriber's job (ADR-098). The schema types
 * `data.span` as present, but the value reaching this function is untrusted
 * wire data behind a cast, so an absent span is read as "no identity to
 * reference" rather than trusted into a TypeError.
 */
export function makeSpanReferencedEvent(
  event: SpanReceivedEvent,
): SpanReferencedEvent | SpanReceivedEvent {
  const span = event.data.span as
    | {
        spanId?: unknown;
        name?: unknown;
        startTimeUnixNano?: unknown;
      }
    | null
    | undefined;
  if (!span || typeof span.spanId !== "string" || span.spanId.length === 0) {
    return event;
  }
  // The resolving read is windowed on this value with `fallback: "none"`, so a
  // reference that cannot state its span's start would be windowed on ingest
  // time instead — permanently blind to any span that started outside the
  // window, and unrecoverable by retry. Stage the full event instead: heavier
  // on the scheduling plane, but it resolves without a store read at all.
  const startTimeUnixMs = parseStartTimeUnixMs(span.startTimeUnixNano);
  if (startTimeUnixMs === null) {
    return event;
  }
  return {
    id: event.id,
    version: SPAN_REFERENCED_EVENT_VERSION_LATEST,
    aggregateId: event.aggregateId,
    aggregateType: event.aggregateType,
    tenantId: event.tenantId,
    createdAt: event.createdAt,
    occurredAt: event.occurredAt,
    type: SPAN_REFERENCED_EVENT_TYPE,
    data: {
      traceId: String(event.aggregateId),
      spanId: span.spanId,
      spanName: typeof span.name === "string" ? span.name : "",
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
 * throws on an unrecognised shape; this seam must be TOTAL (ADR-098: a throw on
 * the retry-less routing path permanently loses the job), so the throw is
 * contained here and reported as null.
 *
 * Parsing a 19-digit ns value through a double loses sub-microsecond precision,
 * which is sub-millisecond after the divide — well inside what partition
 * windowing tolerates.
 */
function parseStartTimeUnixMs(value: unknown): number | null {
  let nano: number;
  try {
    // Typed off the normalizer itself rather than importing `Fixed64` from a
    // deep `build/esm/**/internal-types` path: that path is not public API and
    // moves with the package's build layout, and this way the cast cannot
    // drift from the signature it feeds.
    nano = TraceRequestUtils.normalizeOtlpUnixNano(
      value as Parameters<typeof TraceRequestUtils.normalizeOtlpUnixNano>[0],
    );
  } catch {
    return null;
  }
  if (!Number.isFinite(nano) || nano <= 0) return null;
  return Math.floor(nano / 1e6);
}

/**
 * Zod schema for TopicAssignedEvent metadata.
 */
const topicAssignedEventMetadataSchema = z
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

export const topicAssignedEventSchema = EventSchema.extend({
  type: z.literal(TOPIC_ASSIGNED_EVENT_TYPE),
  version: z.enum(TOPIC_ASSIGNED_EVENT_VERSIONS),
  data: topicAssignedEventDataSchema,
  metadata: topicAssignedEventMetadataSchema,
});

export type TopicAssignedEvent = z.infer<typeof topicAssignedEventSchema>;

/**
 * Zod schema for LogRecordReceivedEvent metadata.
 */
const logRecordReceivedEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

const logRecordReceivedEventDataSchema = z.object({
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

export const logRecordReceivedEventSchema = EventSchema.extend({
  type: z.literal(LOG_RECORD_RECEIVED_EVENT_TYPE),
  version: z.enum(LOG_RECORD_RECEIVED_EVENT_VERSIONS),
  data: logRecordReceivedEventDataSchema,
  metadata: logRecordReceivedEventMetadataSchema,
});

export type LogRecordReceivedEventData = z.infer<
  typeof logRecordReceivedEventDataSchema
>;
export type LogRecordReceivedEvent = z.infer<
  typeof logRecordReceivedEventSchema
>;

const logContributedEventDataSchema = logTraceContributionSchema.omit({
  tenantId: true,
  occurredAt: true,
});

export const logContributedEventSchema = EventSchema.extend({
  type: z.literal(LOG_CONTRIBUTED_EVENT_TYPE),
  version: z.enum(LOG_CONTRIBUTED_EVENT_VERSIONS),
  data: logContributedEventDataSchema,
  metadata: eventMetadataBaseSchema,
});

export type LogContributedEvent = z.infer<typeof logContributedEventSchema>;

/**
 * A valid exemplar correlation is deliberately separate from the canonical
 * metric event. Only this trace-scoped event is visible to trace folds.
 */
const metricDataPointCorrelatedEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

const metricDataPointCorrelatedEventDataSchema = z.object(
  metricCorrelationFields,
);

export const metricDataPointCorrelatedEventSchema = EventSchema.extend({
  type: z.literal(METRIC_DATA_POINT_CORRELATED_EVENT_TYPE),
  version: z.enum(METRIC_DATA_POINT_CORRELATED_EVENT_VERSIONS),
  data: metricDataPointCorrelatedEventDataSchema,
  metadata: metricDataPointCorrelatedEventMetadataSchema,
});

export type MetricDataPointCorrelatedEvent = z.infer<
  typeof metricDataPointCorrelatedEventSchema
>;

/**
 * Zod schema for OriginResolvedEvent metadata.
 */
const originResolvedEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

/**
 * Zod schema for OriginResolvedEvent data.
 */
const originResolvedEventDataSchema = z.object({
  origin: z.string(),
  reason: z.string(),
});

export const originResolvedEventSchema = EventSchema.extend({
  type: z.literal(ORIGIN_RESOLVED_EVENT_TYPE),
  version: z.enum(ORIGIN_RESOLVED_EVENT_VERSIONS),
  data: originResolvedEventDataSchema,
  metadata: originResolvedEventMetadataSchema,
});

export type OriginResolvedEvent = z.infer<typeof originResolvedEventSchema>;

/**
 * Type guard for OriginResolvedEvent.
 */
export function isOriginResolvedEvent(
  event: TraceProcessingEvent,
): event is OriginResolvedEvent {
  return event.type === ORIGIN_RESOLVED_EVENT_TYPE;
}

/**
 * Zod schema for AnnotationAddedEvent metadata.
 */
const annotationAddedEventMetadataSchema = z
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

export const annotationAddedEventSchema = EventSchema.extend({
  type: z.literal(ANNOTATION_ADDED_EVENT_TYPE),
  version: z.enum(ANNOTATION_ADDED_EVENT_VERSIONS),
  data: annotationAddedEventDataSchema,
  metadata: annotationAddedEventMetadataSchema,
});

export type AnnotationAddedEvent = z.infer<typeof annotationAddedEventSchema>;

/**
 * Zod schema for AnnotationRemovedEvent metadata.
 */
const annotationRemovedEventMetadataSchema = z
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

export const annotationRemovedEventSchema = EventSchema.extend({
  type: z.literal(ANNOTATION_REMOVED_EVENT_TYPE),
  version: z.enum(ANNOTATION_REMOVED_EVENT_VERSIONS),
  data: annotationRemovedEventDataSchema,
  metadata: annotationRemovedEventMetadataSchema,
});

export type AnnotationRemovedEvent = z.infer<
  typeof annotationRemovedEventSchema
>;

/**
 * Zod schema for AnnotationsBulkSyncedEvent metadata.
 */
const annotationsBulkSyncedEventMetadataSchema = z
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

export const annotationsBulkSyncedEventSchema = EventSchema.extend({
  type: z.literal(ANNOTATIONS_BULK_SYNCED_EVENT_TYPE),
  version: z.enum(ANNOTATIONS_BULK_SYNCED_EVENT_VERSIONS),
  data: annotationsBulkSyncedEventDataSchema,
  metadata: annotationsBulkSyncedEventMetadataSchema,
});

export type AnnotationsBulkSyncedEvent = z.infer<
  typeof annotationsBulkSyncedEventSchema
>;

/**
 * Zod schema for TraceNameChangedEvent metadata.
 */
const traceNameChangedEventMetadataSchema = z
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

export const traceNameChangedEventSchema = EventSchema.extend({
  type: z.literal(TRACE_NAME_CHANGED_EVENT_TYPE),
  version: z.enum(TRACE_NAME_CHANGED_EVENT_VERSIONS),
  data: traceNameChangedEventDataSchema,
  metadata: traceNameChangedEventMetadataSchema,
});

export type TraceNameChangedEvent = z.infer<typeof traceNameChangedEventSchema>;

/**
 * Union of all trace processing event types.
 */
export type TraceProcessingEvent =
  | SpanReceivedEvent
  | TopicAssignedEvent
  | LogRecordReceivedEvent
  | LogContributedEvent
  | MetricDataPointCorrelatedEvent
  | OriginResolvedEvent
  | AnnotationAddedEvent
  | AnnotationRemovedEvent
  | AnnotationsBulkSyncedEvent
  | TraceNameChangedEvent;
