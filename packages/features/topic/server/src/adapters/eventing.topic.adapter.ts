/**
 * Full durable event schemas for the `topic_clustering` aggregate: the
 * server's event envelope (`EventSchema` — TenantId, AggregateType, ids,
 * timestamps) closed over each event's `type`/`version` literal and its
 * PAYLOAD schema.
 *
 * The payload schemas live in `@langwatch/topic-contract`; this module is
 * the server-only half, where the eventing dependency belongs.
 */

import { EventSchema } from "@langwatch/eventing";
import {
  TOPIC_CLUSTERING_EVENT_TYPES,
  TOPIC_CLUSTERING_EVENT_VERSIONS,
  topicClusteringRequestedEventDataSchema,
  topicClusteringRunCompletedEventDataSchema,
  topicClusteringRunFailedEventDataSchema,
  topicClusteringRunStartedEventDataSchema,
  topicClusteringTopicsRecordedEventDataSchema,
} from "@langwatch/topic-contract";
import { z } from "zod";

export const TopicClusteringRequestedEventSchema = EventSchema.extend({
  type: z.literal(TOPIC_CLUSTERING_EVENT_TYPES.REQUESTED),
  version: z.literal(TOPIC_CLUSTERING_EVENT_VERSIONS.REQUESTED),
  data: topicClusteringRequestedEventDataSchema,
});
export type TopicClusteringRequestedEvent = z.infer<typeof TopicClusteringRequestedEventSchema>;

export const TopicClusteringRunStartedEventSchema = EventSchema.extend({
  type: z.literal(TOPIC_CLUSTERING_EVENT_TYPES.RUN_STARTED),
  version: z.literal(TOPIC_CLUSTERING_EVENT_VERSIONS.RUN_STARTED),
  data: topicClusteringRunStartedEventDataSchema,
});
export type TopicClusteringRunStartedEvent = z.infer<typeof TopicClusteringRunStartedEventSchema>;

export const TopicClusteringRunCompletedEventSchema = EventSchema.extend({
  type: z.literal(TOPIC_CLUSTERING_EVENT_TYPES.RUN_COMPLETED),
  version: z.literal(TOPIC_CLUSTERING_EVENT_VERSIONS.RUN_COMPLETED),
  data: topicClusteringRunCompletedEventDataSchema,
});
export type TopicClusteringRunCompletedEvent = z.infer<
  typeof TopicClusteringRunCompletedEventSchema
>;

export const TopicClusteringRunFailedEventSchema = EventSchema.extend({
  type: z.literal(TOPIC_CLUSTERING_EVENT_TYPES.RUN_FAILED),
  version: z.literal(TOPIC_CLUSTERING_EVENT_VERSIONS.RUN_FAILED),
  data: topicClusteringRunFailedEventDataSchema,
});
export type TopicClusteringRunFailedEvent = z.infer<typeof TopicClusteringRunFailedEventSchema>;

export const TopicClusteringTopicsRecordedEventSchema = EventSchema.extend({
  type: z.literal(TOPIC_CLUSTERING_EVENT_TYPES.TOPICS_RECORDED),
  version: z.literal(TOPIC_CLUSTERING_EVENT_VERSIONS.TOPICS_RECORDED),
  data: topicClusteringTopicsRecordedEventDataSchema,
});
export type TopicClusteringTopicsRecordedEvent = z.infer<
  typeof TopicClusteringTopicsRecordedEventSchema
>;

/** Union of all topic clustering processing event types. */
export type TopicClusteringProcessingEvent =
  | TopicClusteringRequestedEvent
  | TopicClusteringRunStartedEvent
  | TopicClusteringRunCompletedEvent
  | TopicClusteringRunFailedEvent
  | TopicClusteringTopicsRecordedEvent;
