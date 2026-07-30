import { z } from "zod";

/**
 * One run in the project's history, accumulated across the run's pages.
 * Persisted shape of the Postgres-backed run-history read model
 * (`topicClusteringRunHistoryProjection`). Recovered from the deleted
 * event-sourcing tree: this Postgres row predates the pipeline's move to a
 * ClickHouse-backed `topicClusteringRunHistory` fold, so it is kept as its
 * own local type rather than unified with that fold's `RunHistoryViewEntry`
 * (see `event-sourcing/topic-clustering-processing`) — the two are no longer
 * guaranteed to agree on shape.
 *
 * The raw error text is deliberately NOT part of this read model — `errorCode`
 * is the whole contract with the UI, and the raw text stays in the run-status
 * projection for operators.
 */
export const topicClusteringRunHistoryEntrySchema = z.object({
  runId: z.string(),
  /** manual | bootstrap-scheduled runs both read as "scheduled" here. */
  trigger: z.string(),
  /** Business time of the run's first observed event. */
  startedAt: z.number(),
  /** Business time of the terminal event; null while running/abandoned. */
  finishedAt: z.number().nullable(),
  /** running | completed | skipped | failed | abandoned */
  outcome: z.string(),
  mode: z.string().nullable(),
  skippedReason: z.string().nullable(),
  errorCode: z.string().nullable(),
  isErrorUserActionable: z.boolean(),
  tracesProcessed: z.number(),
  topicsCount: z.number(),
  subtopicsCount: z.number(),
  pages: z.number(),
});

export type TopicClusteringRunHistoryEntry = z.infer<
  typeof topicClusteringRunHistoryEntrySchema
>;

export interface TopicClusteringRunHistoryData {
  ProjectId: string;
  /** Newest first. */
  Runs: TopicClusteringRunHistoryEntry[];
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
}
