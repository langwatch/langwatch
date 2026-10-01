/**
 * Full durable event schemas for the `topic_clustering` aggregate: the server's event envelope
 * (`EventSchema` — TenantId, AggregateType, ids, timestamps) closed over each event's
 * `type`/`version` literal and its PAYLOAD schema.
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

export const TopicClusteringRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(TOPIC_CLUSTERING_EVENT_TYPES.REQUESTED),
  version: z.literal(TOPIC_CLUSTERING_EVENT_VERSIONS.REQUESTED),
  data: topicClusteringRequestedEventDataSchema,
});
export type TopicClusteringRequestedEvent = z.infer<typeof TopicClusteringRequestedEventSchema>;

export const TopicClusteringRunStartedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(TOPIC_CLUSTERING_EVENT_TYPES.RUN_STARTED),
  version: z.literal(TOPIC_CLUSTERING_EVENT_VERSIONS.RUN_STARTED),
  data: topicClusteringRunStartedEventDataSchema,
});
export type TopicClusteringRunStartedEvent = z.infer<typeof TopicClusteringRunStartedEventSchema>;

export const TopicClusteringRunCompletedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(TOPIC_CLUSTERING_EVENT_TYPES.RUN_COMPLETED),
  version: z.literal(TOPIC_CLUSTERING_EVENT_VERSIONS.RUN_COMPLETED),
  data: topicClusteringRunCompletedEventDataSchema,
});
export type TopicClusteringRunCompletedEvent = z.infer<
  typeof TopicClusteringRunCompletedEventSchema
>;

export const TopicClusteringRunFailedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(TOPIC_CLUSTERING_EVENT_TYPES.RUN_FAILED),
  version: z.literal(TOPIC_CLUSTERING_EVENT_VERSIONS.RUN_FAILED),
  data: topicClusteringRunFailedEventDataSchema,
});
export type TopicClusteringRunFailedEvent = z.infer<typeof TopicClusteringRunFailedEventSchema>;

export const TopicClusteringTopicsRecordedEventSchema = z.object({
  ...EventSchema.shape,
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

/** The durable event schemas of the `topic_clustering` aggregate, in one place. */
export class EventingTopicEventsService {
  private constructor() {}

  static create(): EventingTopicEventsService {
    return new EventingTopicEventsService();
  }

  static readonly requested = TopicClusteringRequestedEventSchema;
  static readonly runStarted = TopicClusteringRunStartedEventSchema;
  static readonly runCompleted = TopicClusteringRunCompletedEventSchema;
  static readonly runFailed = TopicClusteringRunFailedEventSchema;
  static readonly topicsRecorded = TopicClusteringTopicsRecordedEventSchema;
}
