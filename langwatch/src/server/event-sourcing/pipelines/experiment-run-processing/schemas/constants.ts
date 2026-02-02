/**
 * Event and command type constants for the experiment-run-processing pipeline.
 */

/**
 * Event type identifiers used for routing and filtering events.
 * Format: "lw.<domain>.<action>"
 */
export const EXPERIMENT_RUN_EVENT_TYPES = {
  STARTED: "lw.experiment_run.started",
  TARGET_RESULT: "lw.experiment_run.target_result",
  EVALUATOR_RESULT: "lw.experiment_run.evaluator_result",
  COMPLETED: "lw.experiment_run.completed",
} as const;

// Legacy exports for backwards compatibility
export const EXPERIMENT_RUN_STARTED_EVENT_TYPE =
  EXPERIMENT_RUN_EVENT_TYPES.STARTED;
export const TARGET_RESULT_EVENT_TYPE =
  EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT;
export const EVALUATOR_RESULT_EVENT_TYPE =
  EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT;
export const EXPERIMENT_RUN_COMPLETED_EVENT_TYPE =
  EXPERIMENT_RUN_EVENT_TYPES.COMPLETED;

/**
 * Event schema versions using calendar versioning (YYYY-MM-DD).
 *
 * These versions indicate the schema version of the event data structure.
 * When the event schema changes (fields added/removed/modified), a new version
 * is created. Consumers use these versions to handle backwards compatibility
 * when reading historical events.
 *
 * The date represents when the schema version was introduced, not when the
 * event occurred.
 */
export const EXPERIMENT_RUN_EVENT_VERSIONS = {
  /** Initial schema version for experiment run processing */
  STARTED: "2025-02-01",
  /** Initial schema version for experiment run processing */
  TARGET_RESULT: "2025-02-01",
  /** Initial schema version for experiment run processing */
  EVALUATOR_RESULT: "2025-02-01",
  /** Initial schema version for experiment run processing */
  COMPLETED: "2025-02-01",
} as const;

// Legacy exports for backwards compatibility
export const EXPERIMENT_RUN_STARTED_EVENT_VERSION_LATEST =
  EXPERIMENT_RUN_EVENT_VERSIONS.STARTED;
export const TARGET_RESULT_EVENT_VERSION_LATEST =
  EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT;
export const EVALUATOR_RESULT_EVENT_VERSION_LATEST =
  EXPERIMENT_RUN_EVENT_VERSIONS.EVALUATOR_RESULT;
export const EXPERIMENT_RUN_COMPLETED_EVENT_VERSION_LATEST =
  EXPERIMENT_RUN_EVENT_VERSIONS.COMPLETED;

export const EXPERIMENT_RUN_PROCESSING_EVENT_TYPES = [
  EXPERIMENT_RUN_EVENT_TYPES.STARTED,
  EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
  EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
  EXPERIMENT_RUN_EVENT_TYPES.COMPLETED,
] as const;

export type ExperimentRunProcessingEventType =
  (typeof EXPERIMENT_RUN_PROCESSING_EVENT_TYPES)[number];

/**
 * Command type identifiers used for routing commands to handlers.
 * Format: "lw.<domain>.<action>"
 */
export const EXPERIMENT_RUN_COMMAND_TYPES = {
  START: "lw.experiment_run.start",
  RECORD_TARGET_RESULT: "lw.experiment_run.record_target_result",
  RECORD_EVALUATOR_RESULT: "lw.experiment_run.record_evaluator_result",
  COMPLETE: "lw.experiment_run.complete",
} as const;

// Legacy exports for backwards compatibility
export const START_EXPERIMENT_RUN_COMMAND_TYPE =
  EXPERIMENT_RUN_COMMAND_TYPES.START;
export const RECORD_TARGET_RESULT_COMMAND_TYPE =
  EXPERIMENT_RUN_COMMAND_TYPES.RECORD_TARGET_RESULT;
export const RECORD_EVALUATOR_RESULT_COMMAND_TYPE =
  EXPERIMENT_RUN_COMMAND_TYPES.RECORD_EVALUATOR_RESULT;
export const COMPLETE_EXPERIMENT_RUN_COMMAND_TYPE =
  EXPERIMENT_RUN_COMMAND_TYPES.COMPLETE;

export const EXPERIMENT_RUN_PROCESSING_COMMAND_TYPES = [
  EXPERIMENT_RUN_COMMAND_TYPES.START,
  EXPERIMENT_RUN_COMMAND_TYPES.RECORD_TARGET_RESULT,
  EXPERIMENT_RUN_COMMAND_TYPES.RECORD_EVALUATOR_RESULT,
  EXPERIMENT_RUN_COMMAND_TYPES.COMPLETE,
] as const;

export type ExperimentRunProcessingCommandType =
  (typeof EXPERIMENT_RUN_PROCESSING_COMMAND_TYPES)[number];

/**
 * Projection schema versions using calendar versioning (YYYY-MM-DD).
 *
 * These versions indicate the schema version of the projection data structure.
 * When the projection schema changes, projections may need to be rebuilt from
 * events to apply the new schema.
 */
export const EXPERIMENT_RUN_PROJECTION_VERSIONS = {
  /** Initial projection schema version */
  RUN_STATE: "2025-02-01",
} as const;

// Legacy export for backwards compatibility
export const EXPERIMENT_RUN_STATE_PROJECTION_VERSION_LATEST =
  EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE;

export const EXPERIMENT_RUN_STATE_PROJECTION_VERSIONS = [
  EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE,
] as const;
