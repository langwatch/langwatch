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

/**
 * Event schema versions using calendar versioning (YYYY-MM-DD).
 */
export const EXPERIMENT_RUN_EVENT_VERSIONS = {
  STARTED: "2025-02-01",
  TARGET_RESULT: "2025-02-01",
  EVALUATOR_RESULT: "2025-02-01",
  COMPLETED: "2025-02-01",
} as const;

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
 */
export const EXPERIMENT_RUN_PROJECTION_VERSIONS = {
  RUN_STATE: "2025-02-01",
} as const;
