/**
 * Persisted shape of the Postgres-backed run-status read model
 * (`topicClusteringRunProjection`). Recovered from the deleted
 * event-sourcing tree: the pipeline's own `topicClusteringRunStatus` fold
 * now writes to ClickHouse (see `event-sourcing/topic-clustering-processing`),
 * so this type describes this Postgres row on its own rather than the fold's
 * current state shape.
 */
export interface TopicClusteringRunStatusData {
  ProjectId: string;
  LastRequestedAt: number | null;
  LastRequestTrigger: string | null;
  LastRunAt: number | null;
  /** completed | skipped | failed */
  LastRunOutcome: string | null;
  LastRunMode: string | null;
  LastRunSkippedReason: string | null;
  LastRunError: string | null;
  LastRunErrorCode: string | null;
  /** True when the customer can resolve the failure themselves. */
  LastRunErrorUserActionable: boolean;
  LastRunTracesProcessed: number;
  LastRunTopicsCount: number;
  LastRunSubtopicsCount: number;
  LastRunPages: number;
  InProgressRunId: string | null;
  InProgressTraces: number;
  InProgressPages: number;
  /**
   * Business time the in-progress run opened (its first event), carried
   * unchanged across the run's pages — the projection-side mirror of the
   * process's `startedAtMs`, so the read model can stop reporting a run whose
   * terminal outcome write was lost on the SAME clock the scheduler uses to
   * abandon it.
   */
  InProgressStartedAt: number | null;
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
}
