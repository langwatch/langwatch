/**
 * `simulation_runs`-style pin: `IngestionPullRunProjection` has rows in
 * production stamped under this date, so the fold keeps it rather than adopting
 * a derived hash no live row could match (ADR-105 decision 9).
 */
export const INGESTION_PULL_PROJECTION_VERSIONS = {
  RUN_STATUS: "2026-07-17",
} as const;

export const INGESTION_PULL_RUN_OUTCOME = {
  COMPLETED: "completed",
  FAILED: "failed",
} as const;
