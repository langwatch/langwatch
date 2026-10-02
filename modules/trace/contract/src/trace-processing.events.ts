import { z } from "zod";

import { piiRedactionLevelSchema } from "./trace-ingress.commands.ts";
import {
  isSpanReceivedEvent,
  spanReceivedEventDataSchema,
  spanReceivedEventMetadataSchema,
  spanReceivedEventSchema,
  type SpanReceivedEvent,
  type SpanReceivedEventData,
  type SpanReceivedEventMetadata,
} from "./trace-ingress.events.ts";
import { logTraceContributionSchema } from "./trace-log-contribution.ts";
import { metricCorrelationFields } from "./trace-metric-correlation.ts";
import { recordTraceSpanEventDataSchema } from "./trace-processing.commands.ts";
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
} from "./trace.constants.ts";
import { fixed64Schema } from "./trace.otlp.ts";

export {
  isSpanReceivedEvent,
  spanReceivedEventDataSchema,
  spanReceivedEventMetadataSchema,
  spanReceivedEventSchema,
};
export type { SpanReceivedEvent, SpanReceivedEventData, SpanReceivedEventMetadata };

const aggregateTypeSchema = z.string().trim().min(1);
/**
 * The contract's own definition of a valid tenant id, so minting a branded
 * value here doesn't require depending on `@langwatch/eventing`'s
 * `createTenantId` for a string brand this contract already declares.
 */
export const tenantIdSchema = z
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

export const spanRecordedEventSchema = z.object({
  ...traceEventSchema.shape,
  type: z.literal(SPAN_RECORDED_EVENT_TYPE),
  data: recordTraceSpanEventDataSchema,
  metadata: eventMetadataBaseSchema,
});

type SpanRecordedEvent = z.infer<typeof spanRecordedEventSchema>;

/**
 * Claim-check for `span_received` (ADR-069): staged for subscribers who opt in.
 * Payload, not event; never logged. Fields mirror event envelope.
 */
const spanReferencedPayloadDataSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  /** The raw wire span name, mirrored so gates and debugging never need the store. */
  spanName: z.string(),
  /** Span start time (epoch ms) from wire, or null if unparseable. Descriptive only. */
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
type SpanReferencedPayload = z.infer<typeof spanReferencedPayloadSchema>;

/**
 * Read staged payload. Returns null if not a span reference; throws on shape/
 * version mismatch (to prevent mixed-deploy mistaken no-op).
 */
export function parseSpanReferencedPayload(value: unknown): SpanReferencedPayload | null {
  const candidate = z.object({ type: z.unknown() }).safeParse(value);
  if (!candidate.success || candidate.data.type !== SPAN_REFERENCED_PAYLOAD_TYPE) {
    return null;
  }
  return spanReferencedPayloadSchema.parse(value);
}

/**
 * Build staged reference for `span_received`. Identity only; descriptive fields
 * let gates/logs skip the store. Total at runtime (no retry on routing seam).
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
 * Parse ns→ms from wire `startTimeUnixNano`. Delegates to pipeline normalizer.
 * Total return (null on error); precision loss in double is acceptable.
 */
function fixed64ToNanoseconds(normalized: z.infer<typeof fixed64Schema>): number {
  if (typeof normalized === "number") return normalized;
  if (typeof normalized === "string") return Number.parseInt(normalized, 10);

  return Number((BigInt(normalized.high) << 32n) | (BigInt(normalized.low) & 0xffffffffn));
}

function parseStartTimeUnixMs(value: unknown): number | null {
  const parsed = fixed64Schema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  const nano = fixed64ToNanoseconds(parsed.data);

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

export const topicAssignedEventSchema = z.object({
  ...traceEventSchema.shape,
  type: z.literal(TOPIC_ASSIGNED_EVENT_TYPE),
  data: topicAssignedEventDataSchema,
  metadata: topicAssignedEventMetadataSchema,
});
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

export const logRecordReceivedEventSchema = z.object({
  ...traceEventSchema.shape,
  type: z.literal(LOG_RECORD_RECEIVED_EVENT_TYPE),
  data: logRecordReceivedEventDataSchema,
  metadata: logRecordReceivedEventMetadataSchema,
});

export type LogRecordReceivedEventData = z.infer<typeof logRecordReceivedEventDataSchema>;
export type LogRecordReceivedEvent = z.infer<typeof logRecordReceivedEventSchema>;

const logContributedEventDataSchema = logTraceContributionSchema.omit({
  tenantId: true,
  occurredAt: true,
});

export const logContributedEventSchema = z.object({
  ...traceEventSchema.shape,
  type: z.literal(LOG_CONTRIBUTED_EVENT_TYPE),
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

const metricDataPointCorrelatedEventDataSchema = z.object(metricCorrelationFields);

export const metricDataPointCorrelatedEventSchema = z.object({
  ...traceEventSchema.shape,
  type: z.literal(METRIC_DATA_POINT_CORRELATED_EVENT_TYPE),
  data: metricDataPointCorrelatedEventDataSchema,
  metadata: metricDataPointCorrelatedEventMetadataSchema,
});
export type MetricDataPointCorrelatedEvent = z.infer<typeof metricDataPointCorrelatedEventSchema>;

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
export const originResolvedEventDataSchema = z.object({
  origin: z.string(),
  reason: z.string(),
});

export const originResolvedEventSchema = z.object({
  ...traceEventSchema.shape,
  type: z.literal(ORIGIN_RESOLVED_EVENT_TYPE),
  data: originResolvedEventDataSchema,
  metadata: originResolvedEventMetadataSchema,
});
export type OriginResolvedEvent = z.infer<typeof originResolvedEventSchema>;

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

export const annotationAddedEventSchema = z.object({
  ...traceEventSchema.shape,
  type: z.literal(ANNOTATION_ADDED_EVENT_TYPE),
  data: annotationAddedEventDataSchema,
  metadata: annotationAddedEventMetadataSchema.optional(),
});

export type AnnotationAddedEventData = z.infer<typeof annotationAddedEventDataSchema>;
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

export const annotationRemovedEventSchema = z.object({
  ...traceEventSchema.shape,
  type: z.literal(ANNOTATION_REMOVED_EVENT_TYPE),
  data: annotationRemovedEventDataSchema,
  metadata: annotationRemovedEventMetadataSchema.optional(),
});

export type AnnotationRemovedEventData = z.infer<typeof annotationRemovedEventDataSchema>;
export type AnnotationRemovedEvent = z.infer<typeof annotationRemovedEventSchema>;

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

export const annotationsBulkSyncedEventSchema = z.object({
  ...traceEventSchema.shape,
  type: z.literal(ANNOTATIONS_BULK_SYNCED_EVENT_TYPE),
  data: annotationsBulkSyncedEventDataSchema,
  metadata: annotationsBulkSyncedEventMetadataSchema.optional(),
});
export type AnnotationsBulkSyncedEvent = z.infer<typeof annotationsBulkSyncedEventSchema>;

/**
 * Zod schema for TraceNameChangedEvent metadata.
 */
const traceNameChangedEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

/**
 * The trim+length bounds mirror ChangeTraceName's input schema, so a replay
 * against bad historical data still rejects via Zod instead of silently
 * overriding with a 4 KB blob.
 */
export const traceNameChangedEventDataSchema = z.object({
  traceId: z.string(),
  /** New name. Trim happens at the command boundary; the event stores the canonical form. */
  newName: z.string().min(TRACE_NAME_MIN_LENGTH).max(TRACE_NAME_MAX_LENGTH),
  /** User who made the change, if available — for audit + UI attribution. */
  changedByUserId: z.string().nullable(),
});

export const traceNameChangedEventSchema = z.object({
  ...traceEventSchema.shape,
  type: z.literal(TRACE_NAME_CHANGED_EVENT_TYPE),
  data: traceNameChangedEventDataSchema,
  metadata: traceNameChangedEventMetadataSchema.optional(),
});

export type TraceNameChangedEventData = z.infer<typeof traceNameChangedEventDataSchema>;
export type TraceNameChangedEvent = z.infer<typeof traceNameChangedEventSchema>;

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
