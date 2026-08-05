/**
 * Event and command type constants for the topic-clustering-processing
 * pipeline (ADR-051).
 *
 * Taxonomy: `lw.obs.topic_clustering.<identifier>` — aggregateId is the
 * projectId (one clustering stream per project, TenantId = projectId).
 */

export const TOPIC_CLUSTERING_EVENT_TYPES = {
  REQUESTED: "lw.obs.topic_clustering.requested",
  RUN_STARTED: "lw.obs.topic_clustering.run_started",
  RUN_COMPLETED: "lw.obs.topic_clustering.run_completed",
  RUN_FAILED: "lw.obs.topic_clustering.run_failed",
  TOPICS_RECORDED: "lw.obs.topic_clustering.topics_recorded",
} as const;

export const TOPIC_CLUSTERING_PROCESSING_EVENT_TYPES = [
  TOPIC_CLUSTERING_EVENT_TYPES.REQUESTED,
  TOPIC_CLUSTERING_EVENT_TYPES.RUN_STARTED,
  TOPIC_CLUSTERING_EVENT_TYPES.RUN_COMPLETED,
  TOPIC_CLUSTERING_EVENT_TYPES.RUN_FAILED,
  TOPIC_CLUSTERING_EVENT_TYPES.TOPICS_RECORDED,
] as const;

export type TopicClusteringProcessingEventType =
  (typeof TOPIC_CLUSTERING_PROCESSING_EVENT_TYPES)[number];

export const TOPIC_CLUSTERING_COMMAND_TYPES = {
  REQUEST: "lw.obs.topic_clustering.request",
  RECORD_RUN_STARTED: "lw.obs.topic_clustering.record_run_started",
  RECORD_RUN_COMPLETED: "lw.obs.topic_clustering.record_run_completed",
  RECORD_RUN_FAILED: "lw.obs.topic_clustering.record_run_failed",
  RECORD_TOPICS: "lw.obs.topic_clustering.record_topics",
} as const;

export const TOPIC_CLUSTERING_PROCESSING_COMMAND_TYPES = [
  TOPIC_CLUSTERING_COMMAND_TYPES.REQUEST,
  TOPIC_CLUSTERING_COMMAND_TYPES.RECORD_RUN_STARTED,
  TOPIC_CLUSTERING_COMMAND_TYPES.RECORD_RUN_COMPLETED,
  TOPIC_CLUSTERING_COMMAND_TYPES.RECORD_RUN_FAILED,
  TOPIC_CLUSTERING_COMMAND_TYPES.RECORD_TOPICS,
] as const;

export type TopicClusteringProcessingCommandType =
  (typeof TOPIC_CLUSTERING_PROCESSING_COMMAND_TYPES)[number];

/** Event schema versions using calendar versioning (YYYY-MM-DD). */
export const TOPIC_CLUSTERING_EVENT_VERSIONS = {
  REQUESTED: "2026-07-17",
  RUN_STARTED: "2026-07-19",
  RUN_COMPLETED: "2026-07-17",
  RUN_FAILED: "2026-07-17",
  TOPICS_RECORDED: "2026-07-20",
} as const;

/** Projection schema versions using calendar versioning (YYYY-MM-DD). */
export const TOPIC_CLUSTERING_PROJECTION_VERSIONS = {
  RUN_STATUS: "2026-07-17",
  RUN_HISTORY: "2026-07-20",
  TOPIC_MODEL: "2026-07-20",
} as const;

/** How a topics_recorded event changes the model. */
export const TOPIC_MODEL_RECORD_MODE = {
  /** The event's topics ARE the model; anything else is gone. */
  REPLACE: "replace",
  /** Upsert the event's topics into the existing model. */
  MERGE: "merge",
} as const;
export type TopicModelRecordMode =
  (typeof TOPIC_MODEL_RECORD_MODE)[keyof typeof TOPIC_MODEL_RECORD_MODE];

/** Who recorded the topics. */
export const TOPIC_MODEL_RECORD_SOURCE = {
  CLUSTERING: "clustering",
  /** One-time boot seed of topics that predate event-sourced ownership. */
  SEED: "seed",
} as const;
export type TopicModelRecordSource =
  (typeof TOPIC_MODEL_RECORD_SOURCE)[keyof typeof TOPIC_MODEL_RECORD_SOURCE];

/** How many finished runs the history read model keeps per project. */
export const TOPIC_CLUSTERING_RUN_HISTORY_LIMIT = 50;

/** Why a clustering request was made. */
export const TOPIC_CLUSTERING_TRIGGER = {
  /** The settings-page button (or API) asked for a run now. */
  MANUAL: "manual",
  /** The project became eligible (first trace) or was backfilled. */
  BOOTSTRAP: "bootstrap",
} as const;
export type TopicClusteringTrigger =
  (typeof TOPIC_CLUSTERING_TRIGGER)[keyof typeof TOPIC_CLUSTERING_TRIGGER];

export const TOPIC_CLUSTERING_RUN_MODE = {
  BATCH: "batch",
  INCREMENTAL: "incremental",
} as const;
export type TopicClusteringRunMode =
  (typeof TOPIC_CLUSTERING_RUN_MODE)[keyof typeof TOPIC_CLUSTERING_RUN_MODE];

/**
 * Why a run finished without clustering. The effect handler owns the gate
 * logic (ADR-051 §3); these are its reported outcomes, not process decisions.
 */
export const TOPIC_CLUSTERING_SKIP_REASON = {
  /** The 2/3/7-day cadence window declined a batch re-cluster. */
  RECENTLY_CLUSTERED: "recently_clustered",
  /** The page had fewer usable traces than the mode's minimum. */
  NOT_ENOUGH_TRACES: "not_enough_traces",
  /** No clustering endpoint is configured for this deployment. */
  NOT_CONFIGURED: "not_configured",
} as const;
export type TopicClusteringSkipReason =
  (typeof TOPIC_CLUSTERING_SKIP_REASON)[keyof typeof TOPIC_CLUSTERING_SKIP_REASON];

export const TOPIC_CLUSTERING_RUN_OUTCOME = {
  COMPLETED: "completed",
  SKIPPED: "skipped",
  FAILED: "failed",
  /**
   * History-only: the run is still working. Never a terminal outcome — the
   * status projection reports in-flight runs through its InProgress* fields.
   */
  RUNNING: "running",
  /**
   * History-only: the run's terminal outcome never arrived and a later run
   * superseded it (the scheduler's stale-run guard moved on).
   */
  ABANDONED: "abandoned",
} as const;
export type TopicClusteringRunOutcome =
  (typeof TOPIC_CLUSTERING_RUN_OUTCOME)[keyof typeof TOPIC_CLUSTERING_RUN_OUTCOME];
