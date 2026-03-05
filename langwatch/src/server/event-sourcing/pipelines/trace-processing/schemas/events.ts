import { z } from "zod";

import { EventSchema } from "../../../domain/types";
import { piiRedactionLevelSchema } from "./commands";
import {
	SATISFACTION_SCORE_ASSIGNED_EVENT_TYPE,
	SPAN_RECEIVED_EVENT_TYPE,
	TOPIC_ASSIGNED_EVENT_TYPE,
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
export type TopicAssignedEventData = z.infer<typeof topicAssignedEventDataSchema>;
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
 * Zod schema for SatisfactionScoreAssignedEvent metadata.
 */
export const satisfactionScoreAssignedEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

/**
 * Zod schema for SatisfactionScoreAssignedEvent data.
 */
export const satisfactionScoreAssignedEventDataSchema = z.object({
  satisfactionScore: z.number(),
});

export const satisfactionScoreAssignedEventSchema = EventSchema.extend({
  type: z.literal(SATISFACTION_SCORE_ASSIGNED_EVENT_TYPE),
  data: satisfactionScoreAssignedEventDataSchema,
  metadata: satisfactionScoreAssignedEventMetadataSchema,
});

export type SatisfactionScoreAssignedEventData = z.infer<
  typeof satisfactionScoreAssignedEventDataSchema
>;
export type SatisfactionScoreAssignedEvent = z.infer<
  typeof satisfactionScoreAssignedEventSchema
>;

/**
 * Type guard for SatisfactionScoreAssignedEvent.
 */
export function isSatisfactionScoreAssignedEvent(
  event: TraceProcessingEvent,
): event is SatisfactionScoreAssignedEvent {
  return event.type === SATISFACTION_SCORE_ASSIGNED_EVENT_TYPE;
}

/**
 * Union of all trace processing event types.
 */
export type TraceProcessingEvent =
  | SpanReceivedEvent
  | TopicAssignedEvent
  | SatisfactionScoreAssignedEvent;
