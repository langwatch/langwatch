import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  TOPIC_CLUSTERING_RUN_MODE,
  TOPIC_CLUSTERING_SKIP_REASON,
  TOPIC_CLUSTERING_TRIGGER,
  TOPIC_MODEL_RECORD_MODE,
  TOPIC_MODEL_RECORD_SOURCE,
} from "./topic-clustering.constants.ts";

/**
 * Event DATA schemas for the topic-clustering-processing pipeline (ADR-051)
 * — the portable payload every boundary parses against. Event ENVELOPES live
 * in `@langwatch/topic-process`, where the eventing dependency belongs.
 */

/**
 * The `[occurredAtMs, traceId]` ClickHouse pagination cursor a full page
 * hands to the next one.
 */
const topicClusteringSearchAfterSchemaDefinition = z.tuple([z.number(), z.string()]);
export interface TopicClusteringSearchAfterSchema extends Named<
  typeof topicClusteringSearchAfterSchemaDefinition
> {}
export const topicClusteringSearchAfterSchema: TopicClusteringSearchAfterSchema =
  topicClusteringSearchAfterSchemaDefinition;
export type TopicClusteringSearchAfter = z.infer<typeof topicClusteringSearchAfterSchema>;

/**
 * TopicClusteringRequested — a manual or bootstrap ask for clustering.
 * Daily scheduled runs do NOT emit this event: they are wake-driven inside
 * the process manager (ADR-051 §2).
 */
const topicClusteringRequestedEventDataSchemaDefinition = z.object({
  trigger: z.enum([TOPIC_CLUSTERING_TRIGGER.MANUAL, TOPIC_CLUSTERING_TRIGGER.BOOTSTRAP]),
  /** User who asked, for manual triggers. */
  requestedByUserId: z.string().optional(),
});
export interface TopicClusteringRequestedEventDataSchema extends Named<
  typeof topicClusteringRequestedEventDataSchemaDefinition
> {}
export const topicClusteringRequestedEventDataSchema: TopicClusteringRequestedEventDataSchema =
  topicClusteringRequestedEventDataSchemaDefinition;
export type TopicClusteringRequestedEventData = z.infer<
  typeof topicClusteringRequestedEventDataSchema
>;

/**
 * TopicClusteringRunStarted — needed to rebuild in-progress state on replay.
 * Without it, only run completion is logged.
 */
const topicClusteringRunStartedEventDataSchemaDefinition = z.object({
  /** Logical run identity, shared by every page of one backlog walk. */
  runId: z.string(),
  /** 1-based page number within the run. */
  page: z.number(),
});
export interface TopicClusteringRunStartedEventDataSchema extends Named<
  typeof topicClusteringRunStartedEventDataSchemaDefinition
> {}
export const topicClusteringRunStartedEventDataSchema: TopicClusteringRunStartedEventDataSchema =
  topicClusteringRunStartedEventDataSchemaDefinition;
export type TopicClusteringRunStartedEventData = z.infer<
  typeof topicClusteringRunStartedEventDataSchema
>;

/**
 * TopicClusteringRunCompleted — one clustering page finished (including
 * gate-skipped pages). `runId` identifies the logical run (shared by all
 * pages); `nextSearchAfter` present means more pages remain to walk.
 */
const topicClusteringRunCompletedEventDataSchemaDefinition = z.object({
  /** Logical run identity, e.g. `20260717T093000` or `manual-1789000000000`. */
  runId: z.string(),
  /** 1-based page number within the run. */
  page: z.number(),
  mode: z.enum([TOPIC_CLUSTERING_RUN_MODE.BATCH, TOPIC_CLUSTERING_RUN_MODE.INCREMENTAL]),
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
export interface TopicClusteringRunCompletedEventDataSchema extends Named<
  typeof topicClusteringRunCompletedEventDataSchemaDefinition
> {}
export const topicClusteringRunCompletedEventDataSchema: TopicClusteringRunCompletedEventDataSchema =
  topicClusteringRunCompletedEventDataSchemaDefinition;
export type TopicClusteringRunCompletedEventData = z.infer<
  typeof topicClusteringRunCompletedEventDataSchema
>;

/**
 * TopicClusteringRunFailed — the clustering effect exhausted its retries
 * (ADR-051 §4: 3 attempts, then the intent retires dead and this event
 * records the durable, visible failure).
 */
const topicClusteringRunFailedEventDataSchemaDefinition = z.object({
  runId: z.string(),
  page: z.number(),
  error: z.string(),
  /** Stable failure classification, e.g. `model_provider_auth`. */
  errorCode: z.string().optional(),
  /** True when the customer can resolve it (credentials, quota, config). */
  isUserActionable: z.boolean().optional(),
});
export interface TopicClusteringRunFailedEventDataSchema extends Named<
  typeof topicClusteringRunFailedEventDataSchemaDefinition
> {}
export const topicClusteringRunFailedEventDataSchema: TopicClusteringRunFailedEventDataSchema =
  topicClusteringRunFailedEventDataSchemaDefinition;
export type TopicClusteringRunFailedEventData = z.infer<
  typeof topicClusteringRunFailedEventDataSchema
>;

/**
 * One topic or subtopic in the recorded model. Ids are the SAME nanoids
 * assignTopic writes into ClickHouse TopicId/SubTopicId — they must pass
 * through unchanged, and `centroid`/`p95Distance` make it replay-rebuildable.
 */
const topicModelEntrySchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  /** Parent topic id for subtopics; null for top-level topics. */
  parentId: z.string().nullable(),
  embeddingsModel: z.string(),
  centroid: z.array(z.number()),
  p95Distance: z.number(),
  automaticallyGenerated: z.boolean(),
  /**
   * Epoch ms the topic first existed. Seeds carry the original createdAt so
   * the batch cadence gate (which reads the newest topic's age) keeps its
   * pre-seed answer; clustering omits it and the event's occurredAt is used.
   */
  firstRecordedAt: z.number().optional(),
});
export interface TopicModelEntrySchema extends Named<typeof topicModelEntrySchemaDefinition> {}
export const topicModelEntrySchema: TopicModelEntrySchema = topicModelEntrySchemaDefinition;
export type TopicModelEntry = z.infer<typeof topicModelEntrySchema>;

/**
 * TopicsRecorded — the topic model changed. The Topic table is a projection
 * of these events; nothing else writes it.
 */
const topicClusteringTopicsRecordedEventDataSchemaDefinition = z.object({
  mode: z.enum([TOPIC_MODEL_RECORD_MODE.REPLACE, TOPIC_MODEL_RECORD_MODE.MERGE]),
  source: z.enum([TOPIC_MODEL_RECORD_SOURCE.CLUSTERING, TOPIC_MODEL_RECORD_SOURCE.SEED]),
  /**
   * Deduplicates redeliveries: `run:<runId>:page-<n>` for clustering,
   * `seed:v1` for the boot seed.
   */
  dedupeKey: z.string(),
  topics: z.array(topicModelEntrySchema),
});
export interface TopicClusteringTopicsRecordedEventDataSchema extends Named<
  typeof topicClusteringTopicsRecordedEventDataSchemaDefinition
> {}
export const topicClusteringTopicsRecordedEventDataSchema: TopicClusteringTopicsRecordedEventDataSchema =
  topicClusteringTopicsRecordedEventDataSchemaDefinition;
export type TopicClusteringTopicsRecordedEventData = z.infer<
  typeof topicClusteringTopicsRecordedEventDataSchema
>;
