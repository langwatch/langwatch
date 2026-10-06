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

/**
 * Projection schema versions using calendar versioning (YYYY-MM-DD).
 */
export const EXPERIMENT_RUN_PROJECTION_VERSIONS = {
  RUN_STATE: "2025-02-01",
  RUN_PROGRESS: "2026-09-28",
} as const;
