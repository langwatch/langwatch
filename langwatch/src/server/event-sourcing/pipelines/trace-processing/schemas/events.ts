import { z } from "zod";

import { EventSchema } from "../../../domain/types";
import { metricTypeSchema, piiRedactionLevelSchema } from "./commands";
import {
  ANNOTATION_ADDED_EVENT_TYPE,
  ANNOTATION_REMOVED_EVENT_TYPE,
  ANNOTATIONS_BULK_SYNCED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  METRIC_RECORD_RECEIVED_EVENT_TYPE,
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  TOPIC_ASSIGNED_EVENT_TYPE,
  TRACE_ARCHIVED_EVENT_TYPE,
} from "./constants";
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

export const spanReceivedEventMetadataSchema = eventMetadataBaseSchema.extend({
  spanId: z.string(),
  traceId: z.string(),
});

export const spanReceivedEventDataSchema = z.object({
  span: spanSchema,
  resource: resourceSchema.nullable(),
  instrumentationScope: instrumentationScopeSchema.nullable(),
  piiRedactionLevel: piiRedactionLevelSchema,
});

export const spanReceivedEventSchema = EventSchema.extend({
  type: z.literal(SPAN_RECEIVED_EVENT_TYPE),
  data: spanReceivedEventDataSchema,
  metadata: spanReceivedEventMetadataSchema,
});

export type SpanReceivedEventMetadata = z.infer<
  typeof spanReceivedEventMetadataSchema
>;
export type SpanReceivedEventData = z.infer<typeof spanReceivedEventDataSchema>;
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

export const topicAssignedEventSchema = EventSchema.extend({
  type: z.literal(TOPIC_ASSIGNED_EVENT_TYPE),
  data: topicAssignedEventDataSchema,
  metadata: topicAssignedEventMetadataSchema,
});

export type TopicAssignedEventMetadata = z.infer<
  typeof topicAssignedEventMetadataSchema
>;
export type TopicAssignedEventData = z.infer<
  typeof topicAssignedEventDataSchema
>;
export type TopicAssignedEvent = z.infer<typeof topicAssignedEventSchema>;

/**
 * Type guard for TopicAssignedEvent.
 */
export function isTopicAssignedEvent(
  event: TraceProcessingEvent,
): event is TopicAssignedEvent {
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

export const logRecordReceivedEventSchema = EventSchema.extend({
  type: z.literal(LOG_RECORD_RECEIVED_EVENT_TYPE),
  data: logRecordReceivedEventDataSchema,
  metadata: logRecordReceivedEventMetadataSchema,
});

export type LogRecordReceivedEventData = z.infer<
  typeof logRecordReceivedEventDataSchema
>;
export type LogRecordReceivedEvent = z.infer<
  typeof logRecordReceivedEventSchema
>;

export function isLogRecordReceivedEvent(
  event: TraceProcessingEvent,
): event is LogRecordReceivedEvent {
  return event.type === LOG_RECORD_RECEIVED_EVENT_TYPE;
}

/**
 * Zod schema for MetricRecordReceivedEvent metadata.
 */
export const metricRecordReceivedEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

export const metricRecordReceivedEventDataSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  metricName: z.string(),
  metricUnit: z.string(),
  metricType: metricTypeSchema,
  value: z.number(),
  timeUnixMs: z.number(),
  attributes: z.record(z.string(), z.string()),
  resourceAttributes: z.record(z.string(), z.string()),
});

export const metricRecordReceivedEventSchema = EventSchema.extend({
  type: z.literal(METRIC_RECORD_RECEIVED_EVENT_TYPE),
  data: metricRecordReceivedEventDataSchema,
  metadata: metricRecordReceivedEventMetadataSchema,
});

export type MetricRecordReceivedEventData = z.infer<
  typeof metricRecordReceivedEventDataSchema
>;
export type MetricRecordReceivedEvent = z.infer<
  typeof metricRecordReceivedEventSchema
>;

export function isMetricRecordReceivedEvent(
  event: TraceProcessingEvent,
): event is MetricRecordReceivedEvent {
  return event.type === METRIC_RECORD_RECEIVED_EVENT_TYPE;
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

export const originResolvedEventSchema = EventSchema.extend({
  type: z.literal(ORIGIN_RESOLVED_EVENT_TYPE),
  data: originResolvedEventDataSchema,
  metadata: originResolvedEventMetadataSchema,
});

export type OriginResolvedEventData = z.infer<
  typeof originResolvedEventDataSchema
>;
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

export const annotationAddedEventSchema = EventSchema.extend({
  type: z.literal(ANNOTATION_ADDED_EVENT_TYPE),
  data: annotationAddedEventDataSchema,
  metadata: annotationAddedEventMetadataSchema,
});

export type AnnotationAddedEventData = z.infer<
  typeof annotationAddedEventDataSchema
>;
export type AnnotationAddedEvent = z.infer<typeof annotationAddedEventSchema>;

/**
 * Type guard for AnnotationAddedEvent.
 */
export function isAnnotationAddedEvent(
  event: TraceProcessingEvent,
): event is AnnotationAddedEvent {
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

export const annotationRemovedEventSchema = EventSchema.extend({
  type: z.literal(ANNOTATION_REMOVED_EVENT_TYPE),
  data: annotationRemovedEventDataSchema,
  metadata: annotationRemovedEventMetadataSchema,
});

export type AnnotationRemovedEventData = z.infer<
  typeof annotationRemovedEventDataSchema
>;
export type AnnotationRemovedEvent = z.infer<
  typeof annotationRemovedEventSchema
>;

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

export const annotationsBulkSyncedEventSchema = EventSchema.extend({
  type: z.literal(ANNOTATIONS_BULK_SYNCED_EVENT_TYPE),
  data: annotationsBulkSyncedEventDataSchema,
  metadata: annotationsBulkSyncedEventMetadataSchema,
});

export type AnnotationsBulkSyncedEventData = z.infer<
  typeof annotationsBulkSyncedEventDataSchema
>;
export type AnnotationsBulkSyncedEvent = z.infer<
  typeof annotationsBulkSyncedEventSchema
>;

/**
 * Type guard for AnnotationsBulkSyncedEvent.
 */
export function isAnnotationsBulkSyncedEvent(
  event: TraceProcessingEvent,
): event is AnnotationsBulkSyncedEvent {
  return event.type === ANNOTATIONS_BULK_SYNCED_EVENT_TYPE;
}

/**
 * Zod schema for TraceArchivedEvent metadata.
 */
export const traceArchivedEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

/**
 * Zod schema for TraceArchivedEvent data.
 */
export const traceArchivedEventDataSchema = z.object({
  traceId: z.string(),
  archivedAtMs: z.number(),
});

export const traceArchivedEventSchema = EventSchema.extend({
  type: z.literal(TRACE_ARCHIVED_EVENT_TYPE),
  data: traceArchivedEventDataSchema,
  metadata: traceArchivedEventMetadataSchema,
});

export type TraceArchivedEventData = z.infer<
  typeof traceArchivedEventDataSchema
>;
export type TraceArchivedEvent = z.infer<typeof traceArchivedEventSchema>;

/**
 * Type guard for TraceArchivedEvent.
 */
export function isTraceArchivedEvent(
  event: TraceProcessingEvent,
): event is TraceArchivedEvent {
  return event.type === TRACE_ARCHIVED_EVENT_TYPE;
}

/**
 * Union of all trace processing event types.
 */
export type TraceProcessingEvent =
  | SpanReceivedEvent
  | TopicAssignedEvent
  | LogRecordReceivedEvent
  | MetricRecordReceivedEvent
  | OriginResolvedEvent
  | AnnotationAddedEvent
  | AnnotationRemovedEvent
  | AnnotationsBulkSyncedEvent
  | TraceArchivedEvent;
