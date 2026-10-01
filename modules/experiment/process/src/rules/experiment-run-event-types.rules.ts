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
  TRACE_METRICS_COMPUTED: "lw.experiment_run.trace_metrics_computed",
  WORKFLOW_EVALUATION_REQUESTED: "lw.experiment_run.workflow_evaluation_requested",
  CELL_FINISHED: "lw.experiment_run.cell_finished",
  ABORT_REQUESTED: "lw.experiment_run.abort_requested",
} as const;

/**
 * Event schema versions using calendar versioning (YYYY-MM-DD).
 */
export const EXPERIMENT_RUN_EVENT_VERSIONS = {
  STARTED: "2026-09-28",
  TARGET_RESULT: "2025-02-01",
  EVALUATOR_RESULT: "2026-09-28",
  COMPLETED: "2026-09-28",
  TRACE_METRICS_COMPUTED: "2026-04-15",
  WORKFLOW_EVALUATION_REQUESTED: "2026-09-25",
  CELL_FINISHED: "2026-09-28",
  ABORT_REQUESTED: "2026-09-28",
} as const;

export const EXPERIMENT_RUN_PROCESSING_EVENT_TYPES = [
  EXPERIMENT_RUN_EVENT_TYPES.STARTED,
  EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
  EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
  EXPERIMENT_RUN_EVENT_TYPES.COMPLETED,
  EXPERIMENT_RUN_EVENT_TYPES.TRACE_METRICS_COMPUTED,
  EXPERIMENT_RUN_EVENT_TYPES.WORKFLOW_EVALUATION_REQUESTED,
  EXPERIMENT_RUN_EVENT_TYPES.CELL_FINISHED,
  EXPERIMENT_RUN_EVENT_TYPES.ABORT_REQUESTED,
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
  COMPUTE_TRACE_METRICS: "lw.experiment_run.compute_trace_metrics",
  REQUEST_WORKFLOW_EVALUATION: "lw.experiment_run.request_workflow_evaluation",
  FAIL_CELL: "lw.experiment_run.fail_cell",
  ABORT: "lw.experiment_run.abort",
  EXECUTE_CELL: "lw.experiment_run.execute_cell",
} as const;

export const EXPERIMENT_RUN_PROCESSING_COMMAND_TYPES = [
  EXPERIMENT_RUN_COMMAND_TYPES.START,
  EXPERIMENT_RUN_COMMAND_TYPES.RECORD_TARGET_RESULT,
  EXPERIMENT_RUN_COMMAND_TYPES.RECORD_EVALUATOR_RESULT,
  EXPERIMENT_RUN_COMMAND_TYPES.COMPLETE,
  EXPERIMENT_RUN_COMMAND_TYPES.COMPUTE_TRACE_METRICS,
  EXPERIMENT_RUN_COMMAND_TYPES.REQUEST_WORKFLOW_EVALUATION,
  EXPERIMENT_RUN_COMMAND_TYPES.FAIL_CELL,
  EXPERIMENT_RUN_COMMAND_TYPES.ABORT,
  EXPERIMENT_RUN_COMMAND_TYPES.EXECUTE_CELL,
] as const;

export type ExperimentRunProcessingCommandType =
  (typeof EXPERIMENT_RUN_PROCESSING_COMMAND_TYPES)[number];

/**
 * Projection schema versions using calendar versioning (YYYY-MM-DD).
 */
export const EXPERIMENT_RUN_PROJECTION_VERSIONS = {
  RUN_STATE: "2025-02-01",
  RUN_PROGRESS: "2026-09-28",
} as const;
