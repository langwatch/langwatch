import { z } from "zod";

/**
 * Shared shapes for the `topic_clustering` aggregate (ADR-105).
 *
 * Every event data schema below carries `occurredAt` explicitly, inside the
 * payload rather than on an envelope. The old `Event` type carried
 * `occurredAt` as an envelope field the store stamped independently of
 * `data`; the shipped `@langwatch/event-sourcing` `AggregateEvent` is exactly
 * `{ type, data }` (`aggregate.types.ts`) with no envelope field for it at
 * all. A fold that needs a per-field last-write-wins stamp (ADR-098 decision
 * 4) has nowhere else to read one from, so it travels as an ordinary payload
 * field here — see `aggregate.ts`'s module docblock for the matching gap on
 * idempotency keys, and each fold's own docblock for which fields actually
 * read this value as their ordering stamp.
 */

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

/** How a `topicsRecorded` event changes the model: the event's topics ARE
 * the model (`replace`), or the event's topics are upserted into it (`merge`). */
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
 * One topic or subtopic in the recorded model. Ids are the SAME nanoids the
 * trace-assignment path writes into ClickHouse `TopicId`/`SubTopicId`
 * (`specs/topic-clustering/trace-assignment.feature`), so they must pass
 * through unchanged.
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
  /** Epoch ms the topic first existed, if the caller knows it (a seed
   * carries the original createdAt); otherwise derived by the fold from the
   * first event that recorded the topic. */
  firstRecordedAt: z.number().optional(),
});
export type TopicModelEntry = z.infer<typeof topicModelEntrySchema>;

// ---------------------------------------------------------------------------
// Event data schemas — one per event the `topic_clustering` aggregate emits.
// ---------------------------------------------------------------------------

/**
 * A manual or bootstrap ask for clustering. Daily scheduled runs do NOT emit
 * this: they are wake-driven inside the process manager
 * (`process-manager/schedule.ts`).
 */
export const requestedDataSchema = z.object({
  trigger: topicClusteringTriggerSchema,
  /** User who asked, for manual triggers. */
  requestedByUserId: z.string().optional(),
  occurredAt: z.number(),
});
export type RequestedData = z.infer<typeof requestedDataSchema>;

/**
 * The effect began working a page. Without this, the log only records how
 * runs END, so "a run is in progress" is not rebuildable by replay.
 */
export const runStartedDataSchema = z.object({
  /** Logical run identity, shared by every page of one backlog walk. */
  runId: z.string(),
  /** 1-based page number within the run. */
  page: z.number(),
  occurredAt: z.number(),
});
export type RunStartedData = z.infer<typeof runStartedDataSchema>;

/**
 * One clustering page finished (including gate-skipped pages).
 * `nextSearchAfter` present means the backlog has more pages and the process
 * should continue the walk.
 */
export const runCompletedDataSchema = z.object({
  runId: z.string(),
  page: z.number(),
  mode: topicClusteringRunModeSchema,
  tracesProcessed: z.number(),
  topicsCount: z.number(),
  subtopicsCount: z.number(),
  skippedReason: topicClusteringSkipReasonSchema.optional(),
  nextSearchAfter: topicClusteringSearchAfterSchema.optional(),
  occurredAt: z.number(),
});
export type RunCompletedData = z.infer<typeof runCompletedDataSchema>;

/** The clustering effect exhausted its retries. */
export const runFailedDataSchema = z.object({
  runId: z.string(),
  page: z.number(),
  error: z.string(),
  /** Stable failure classification, e.g. `model_provider_auth`. */
  errorCode: z.string().optional(),
  /** True when the customer can resolve it (credentials, quota, config). */
  isUserActionable: z.boolean().optional(),
  occurredAt: z.number(),
});
export type RunFailedData = z.infer<typeof runFailedDataSchema>;

/** The topic model changed. The topic-model fold is the only writer of the
 * projected model; nothing else owns it. */
export const topicsRecordedDataSchema = z.object({
  mode: topicModelRecordModeSchema,
  source: topicModelRecordSourceSchema,
  /** Deduplicates redeliveries: `run:<runId>:page-<n>` for clustering,
   * `seed:v1` for the boot seed. */
  dedupeKey: z.string(),
  topics: z.array(topicModelEntrySchema),
  occurredAt: z.number(),
});
export type TopicsRecordedData = z.infer<typeof topicsRecordedDataSchema>;
