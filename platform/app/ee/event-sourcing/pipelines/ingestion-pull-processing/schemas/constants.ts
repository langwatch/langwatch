export const INGESTION_PULL_EVENT_TYPES = {
  CONFIGURED: "lw.obs.ingestion_pull.configured",
  DISABLED: "lw.obs.ingestion_pull.disabled",
  RUN_COMPLETED: "lw.obs.ingestion_pull.run_completed",
  RUN_FAILED: "lw.obs.ingestion_pull.run_failed",
} as const;

export const INGESTION_PULL_PROCESSING_EVENT_TYPES = [
  INGESTION_PULL_EVENT_TYPES.CONFIGURED,
  INGESTION_PULL_EVENT_TYPES.DISABLED,
  INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED,
  INGESTION_PULL_EVENT_TYPES.RUN_FAILED,
] as const;

export type IngestionPullProcessingEventType =
  (typeof INGESTION_PULL_PROCESSING_EVENT_TYPES)[number];

export const INGESTION_PULL_COMMAND_TYPES = {
  CONFIGURE: "lw.obs.ingestion_pull.configure",
  DISABLE: "lw.obs.ingestion_pull.disable",
  RECORD_RUN_COMPLETED: "lw.obs.ingestion_pull.record_run_completed",
  RECORD_RUN_FAILED: "lw.obs.ingestion_pull.record_run_failed",
} as const;

export const INGESTION_PULL_PROCESSING_COMMAND_TYPES = [
  INGESTION_PULL_COMMAND_TYPES.CONFIGURE,
  INGESTION_PULL_COMMAND_TYPES.DISABLE,
  INGESTION_PULL_COMMAND_TYPES.RECORD_RUN_COMPLETED,
  INGESTION_PULL_COMMAND_TYPES.RECORD_RUN_FAILED,
] as const;

export type IngestionPullProcessingCommandType =
  (typeof INGESTION_PULL_PROCESSING_COMMAND_TYPES)[number];

/** Event schema versions using calendar versioning (YYYY-MM-DD). */
export const INGESTION_PULL_EVENT_VERSIONS = {
  CONFIGURED: "2026-07-17",
  DISABLED: "2026-07-17",
  RUN_COMPLETED: "2026-07-17",
  RUN_FAILED: "2026-07-17",
} as const;

/** Projection schema versions using calendar versioning (YYYY-MM-DD). */
export const INGESTION_PULL_PROJECTION_VERSIONS = {
  RUN_STATUS: "2026-07-17",
} as const;

export const INGESTION_PULL_RUN_OUTCOME = {
  COMPLETED: "completed",
  FAILED: "failed",
} as const;
export type IngestionPullRunOutcome =
  (typeof INGESTION_PULL_RUN_OUTCOME)[keyof typeof INGESTION_PULL_RUN_OUTCOME];
