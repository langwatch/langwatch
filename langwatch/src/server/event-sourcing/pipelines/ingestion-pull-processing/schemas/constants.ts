export const INGESTION_PULL_EVENT_TYPES = {
  CONFIGURED: "lw.obs.ingestion_pull.configured",
  DISABLED: "lw.obs.ingestion_pull.disabled",
  RUN_COMPLETED: "lw.obs.ingestion_pull.run_completed",
  RUN_FAILED: "lw.obs.ingestion_pull.run_failed",
} as const;

export const INGESTION_PULL_PROCESSING_EVENT_TYPES = Object.values(
  INGESTION_PULL_EVENT_TYPES,
);

export const INGESTION_PULL_COMMAND_TYPES = {
  CONFIGURE: "lw.obs.ingestion_pull.configure",
  DISABLE: "lw.obs.ingestion_pull.disable",
  RECORD_RUN_COMPLETED: "lw.obs.ingestion_pull.record_run_completed",
  RECORD_RUN_FAILED: "lw.obs.ingestion_pull.record_run_failed",
} as const;

export const INGESTION_PULL_PROCESSING_COMMAND_TYPES = Object.values(
  INGESTION_PULL_COMMAND_TYPES,
);

export const INGESTION_PULL_EVENT_VERSION = "2026-07-17" as const;
export const INGESTION_PULL_PROJECTION_VERSION = "2026-07-17" as const;

export const INGESTION_PULL_RUN_OUTCOME = {
  COMPLETED: "completed",
  FAILED: "failed",
} as const;
