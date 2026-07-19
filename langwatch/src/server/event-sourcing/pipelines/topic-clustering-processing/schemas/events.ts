import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import {
  TOPIC_CLUSTERING_EVENT_TYPES,
  TOPIC_CLUSTERING_EVENT_VERSIONS,
  TOPIC_CLUSTERING_RUN_MODE,
  TOPIC_CLUSTERING_SKIP_REASON,
  TOPIC_CLUSTERING_TRIGGER,
} from "./constants";

/**
 * The `[occurredAtMs, traceId]` ClickHouse pagination cursor a full page
 * hands to the next one (the same shape the BullMQ payload used to carry).
 */
export const topicClusteringSearchAfterSchema = z.tuple([
  z.number(),
  z.string(),
]);
export type TopicClusteringSearchAfter = z.infer<
  typeof topicClusteringSearchAfterSchema
>;

/**
 * TopicClusteringRequested — a manual or bootstrap ask for clustering.
 * Daily scheduled runs do NOT emit this event: they are wake-driven inside
 * the process manager (ADR-051 §2).
 */
export const topicClusteringRequestedEventDataSchema = z.object({
  trigger: z.enum([
    TOPIC_CLUSTERING_TRIGGER.MANUAL,
    TOPIC_CLUSTERING_TRIGGER.BOOTSTRAP,
  ]),
  /** User who asked, for manual triggers. */
  requestedByUserId: z.string().optional(),
});
export type TopicClusteringRequestedEventData = z.infer<
  typeof topicClusteringRequestedEventDataSchema
>;

export const TopicClusteringRequestedEventSchema = EventSchema.extend({
  type: z.literal(TOPIC_CLUSTERING_EVENT_TYPES.REQUESTED),
  version: z.literal(TOPIC_CLUSTERING_EVENT_VERSIONS.REQUESTED),
  data: topicClusteringRequestedEventDataSchema,
});
export type TopicClusteringRequestedEvent = z.infer<
  typeof TopicClusteringRequestedEventSchema
>;

/**
 * TopicClusteringRunStarted — the effect began working a page.
 *
 * Without it the log only records how runs END, so "a run is in progress"
 * is not rebuildable by replay: a scheduled run emits nothing at its start
 * (the wake is process-internal), and a run that finishes in a single page
 * never looks in-flight at all. The settings page has to infer it, and got
 * it wrong.
 */
export const topicClusteringRunStartedEventDataSchema = z.object({
  /** Logical run identity, shared by every page of one backlog walk. */
  runId: z.string(),
  /** 1-based page number within the run. */
  page: z.number(),
});
export type TopicClusteringRunStartedEventData = z.infer<
  typeof topicClusteringRunStartedEventDataSchema
>;

export const TopicClusteringRunStartedEventSchema = EventSchema.extend({
  type: z.literal(TOPIC_CLUSTERING_EVENT_TYPES.RUN_STARTED),
  version: z.literal(TOPIC_CLUSTERING_EVENT_VERSIONS.RUN_STARTED),
  data: topicClusteringRunStartedEventDataSchema,
});
export type TopicClusteringRunStartedEvent = z.infer<
  typeof TopicClusteringRunStartedEventSchema
>;

/**
 * TopicClusteringRunCompleted — one clustering page finished (including
 * gate-skipped pages). `runId` identifies the logical run (all pages of one
 * backlog walk share it); `nextSearchAfter` present means the backlog has
 * more pages and the process should continue the walk.
 */
export const topicClusteringRunCompletedEventDataSchema = z.object({
  /** Logical run identity, e.g. `20260717T093000` or `manual-1789000000000`. */
  runId: z.string(),
  /** 1-based page number within the run. */
  page: z.number(),
  mode: z.enum([
    TOPIC_CLUSTERING_RUN_MODE.BATCH,
    TOPIC_CLUSTERING_RUN_MODE.INCREMENTAL,
  ]),
  tracesProcessed: z.number(),
  topicsCount: z.number(),
  subtopicsCount: z.number(),
  skippedReason: z
    .enum([
      TOPIC_CLUSTERING_SKIP_REASON.RECENTLY_CLUSTERED,
      TOPIC_CLUSTERING_SKIP_REASON.NOT_ENOUGH_TRACES,
      TOPIC_CLUSTERING_SKIP_REASON.NOT_CONFIGURED,
    ])
    .optional(),
  nextSearchAfter: topicClusteringSearchAfterSchema.optional(),
});
export type TopicClusteringRunCompletedEventData = z.infer<
  typeof topicClusteringRunCompletedEventDataSchema
>;

export const TopicClusteringRunCompletedEventSchema = EventSchema.extend({
  type: z.literal(TOPIC_CLUSTERING_EVENT_TYPES.RUN_COMPLETED),
  version: z.literal(TOPIC_CLUSTERING_EVENT_VERSIONS.RUN_COMPLETED),
  data: topicClusteringRunCompletedEventDataSchema,
});
export type TopicClusteringRunCompletedEvent = z.infer<
  typeof TopicClusteringRunCompletedEventSchema
>;

/**
 * TopicClusteringRunFailed — the clustering effect exhausted its retries
 * (ADR-051 §4: 3 attempts, then the intent retires dead and this event
 * records the durable, visible failure).
 */
export const topicClusteringRunFailedEventDataSchema = z.object({
  runId: z.string(),
  page: z.number(),
  error: z.string(),
  /** Stable failure classification, e.g. `model_provider_auth`. */
  errorCode: z.string().optional(),
  /** True when the customer can resolve it (credentials, quota, config). */
  isUserActionable: z.boolean().optional(),
});
export type TopicClusteringRunFailedEventData = z.infer<
  typeof topicClusteringRunFailedEventDataSchema
>;

export const TopicClusteringRunFailedEventSchema = EventSchema.extend({
  type: z.literal(TOPIC_CLUSTERING_EVENT_TYPES.RUN_FAILED),
  version: z.literal(TOPIC_CLUSTERING_EVENT_VERSIONS.RUN_FAILED),
  data: topicClusteringRunFailedEventDataSchema,
});
export type TopicClusteringRunFailedEvent = z.infer<
  typeof TopicClusteringRunFailedEventSchema
>;

/** Union of all topic clustering processing event types. */
export type TopicClusteringProcessingEvent =
  | TopicClusteringRequestedEvent
  | TopicClusteringRunStartedEvent
  | TopicClusteringRunCompletedEvent
  | TopicClusteringRunFailedEvent;
