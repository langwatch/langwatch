import { z } from "zod";

import { topicClusteringSearchAfterSchema } from "~/server/event-sourcing/pipelines/topic-clustering-processing/schemas/events";

export const TOPIC_CLUSTERING_PROCESS_NAME = "topicClustering" as const;

export const TOPIC_CLUSTERING_PROCESS_INTENT_TYPES = {
  /** Run one clustering page for the project. */
  RUN: "topic_clustering.run",
} as const;

/**
 * The clustering run intent payload. `searchAfter` is null for the first
 * page; continuation intents carry the cursor the previous page returned.
 */
export const topicClusteringRunIntentSchema = z.object({
  runId: z.string(),
  page: z.number(),
  searchAfter: topicClusteringSearchAfterSchema.nullable(),
});
export type TopicClusteringRunIntent = z.infer<
  typeof topicClusteringRunIntentSchema
>;

/**
 * Compact private process state (ADR-051 §2): only what evolve() decisions
 * need. Run facts for the UI live in the run-status projection, not here.
 */
export interface TopicClusteringProcessState {
  /** The aggregate identity; needed to compute the daily hash slot on wakes. */
  projectId: string;
  enabled: boolean;
  /**
   * The run currently in flight, or null when idle. Guards a wake or manual
   * request from piling a second run onto an active backlog walk. Cleared by
   * the final run_completed / run_failed, or abandoned by a wake once
   * `updatedAtMs` is older than the stale-run window.
   */
  currentRun: {
    runId: string;
    page: number;
    updatedAtMs: number;
  } | null;
}

/**
 * The content-stripped view of a pipeline event the process consumes.
 * Clustering events carry no customer content, but the boundary keeps the
 * same shape discipline as other process managers.
 */
export const topicClusteringProcessEventViewSchema = z.object({
  trigger: z.string().nullable(),
  runId: z.string().nullable(),
  page: z.number().nullable(),
  hasNextPage: z.boolean(),
  nextSearchAfter: topicClusteringSearchAfterSchema.nullable(),
});
export type TopicClusteringProcessEventView = z.infer<
  typeof topicClusteringProcessEventViewSchema
>;
