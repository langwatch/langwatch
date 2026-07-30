import { z } from "zod";

/**
 * The `topic_clustering` event payloads.
 *
 * Every one carries `projectId` and `occurredAt`: an aggregate is handed an
 * event's `data` and nothing else, so the aggregate id it is keyed by and the
 * stamp its folds order on both have to be event-carried.
 */

/** One clustering stream per project, so the aggregate id is the project. */
const streamIdentity = z.object({
  projectId: z.string(),
  occurredAt: z.number(),
});

export const topicClusteringTriggerSchema = z.enum(["manual", "bootstrap"]);
export type TopicClusteringTrigger = z.infer<
  typeof topicClusteringTriggerSchema
>;

export const topicClusteringRunModeSchema = z.enum(["batch", "incremental"]);
export type TopicClusteringRunMode = z.infer<
  typeof topicClusteringRunModeSchema
>;

export const topicClusteringSkipReasonSchema = z.enum([
  "recently_clustered",
  "not_enough_traces",
  "not_configured",
]);
export type TopicClusteringSkipReason = z.infer<
  typeof topicClusteringSkipReasonSchema
>;

/** Whether the event's topics ARE the model (`replace`) or are upserted into
 * it (`merge`). */
export const topicModelRecordModeSchema = z.enum(["replace", "merge"]);
export type TopicModelRecordMode = z.infer<typeof topicModelRecordModeSchema>;

/** `seed` is the one-time boot seed of topics that predate event-sourced
 * ownership; `clustering` is a real batch/incremental run. */
export const topicModelRecordSourceSchema = z.enum(["clustering", "seed"]);
export type TopicModelRecordSource = z.infer<
  typeof topicModelRecordSourceSchema
>;

/** The `[occurredAtMs, traceId]` ClickHouse pagination cursor a full page
 * hands to the next one. */
export const topicClusteringSearchAfterSchema = z.tuple([
  z.number(),
  z.string(),
]);
export type TopicClusteringSearchAfter = z.infer<
  typeof topicClusteringSearchAfterSchema
>;

/**
 * One topic or subtopic in the recorded model. Ids are the same nanoids the
 * trace-assignment path writes into ClickHouse `TopicId`/`SubTopicId`
 * (specs/topic-clustering/trace-assignment.feature), so they pass through
 * unchanged.
 */
export const topicModelEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Parent topic id for subtopics; null for top-level topics. */
  parentId: z.string().nullable(),
  embeddingsModel: z.string(),
  centroid: z.array(z.number()),
  p95Distance: z.number(),
  automaticallyGenerated: z.boolean(),
  /** Epoch ms the topic first existed, when the caller knows it (a seed
   * carries the original createdAt); otherwise the fold derives it. */
  firstRecordedAt: z.number().optional(),
});
export type TopicModelEntry = z.infer<typeof topicModelEntrySchema>;

/**
 * A manual or bootstrap ask for clustering. Daily scheduled runs do not emit
 * this — they are wake-driven inside the process manager.
 */
export const requestedDataSchema = streamIdentity.extend({
  trigger: topicClusteringTriggerSchema,
  /** User who asked, for manual triggers. */
  requestedByUserId: z.string().optional(),
});
export type RequestedData = z.infer<typeof requestedDataSchema>;

/** The effect began working a page. Without this the log only records how
 * runs END, so "a run is in progress" is not rebuildable by replay. */
export const runStartedDataSchema = streamIdentity.extend({
  /** Logical run identity, shared by every page of one backlog walk. */
  runId: z.string(),
  /** 1-based page number within the run. */
  page: z.number(),
});
export type RunStartedData = z.infer<typeof runStartedDataSchema>;

/** One clustering page finished, gate-skipped pages included.
 * `nextSearchAfter` present means the backlog has more pages. */
export const runCompletedDataSchema = streamIdentity.extend({
  runId: z.string(),
  page: z.number(),
  mode: topicClusteringRunModeSchema,
  tracesProcessed: z.number(),
  topicsCount: z.number(),
  subtopicsCount: z.number(),
  skippedReason: topicClusteringSkipReasonSchema.optional(),
  nextSearchAfter: topicClusteringSearchAfterSchema.optional(),
});
export type RunCompletedData = z.infer<typeof runCompletedDataSchema>;

/** The clustering effect exhausted its retries. */
export const runFailedDataSchema = streamIdentity.extend({
  runId: z.string(),
  page: z.number(),
  error: z.string(),
  /** Stable failure classification, e.g. `model_provider_auth`. */
  errorCode: z.string().optional(),
  /** True when the customer can resolve it (credentials, quota, config). */
  isUserActionable: z.boolean().optional(),
});
export type RunFailedData = z.infer<typeof runFailedDataSchema>;

/** The topic model changed. The topic-model fold is its only writer. */
export const topicsRecordedDataSchema = streamIdentity.extend({
  mode: topicModelRecordModeSchema,
  source: topicModelRecordSourceSchema,
  /** Deduplicates redeliveries: `run:<runId>:page-<n>` for clustering,
   * `seed:v1` for the boot seed. */
  dedupeKey: z.string(),
  topics: z.array(topicModelEntrySchema),
});
export type TopicsRecordedData = z.infer<typeof topicsRecordedDataSchema>;
