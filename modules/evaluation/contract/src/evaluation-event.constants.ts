/**
 * Event and command type constants for the Evaluation pipeline.
 */

/**
 * Event type identifiers used for routing and filtering events.
 * Format: "lw.<domain>.<action>"
 */
export const EVALUATION_EVENT_TYPES = {
  SCHEDULED: "lw.evaluation.scheduled",
  STARTED: "lw.evaluation.started",
  COMPLETED: "lw.evaluation.completed",
  REPORTED: "lw.evaluation.reported",
  ATTEMPT_FAILED: "lw.evaluation.attempt_failed",
} as const;

// Legacy exports for backwards compatibility
export const EVALUATION_SCHEDULED_EVENT_TYPE = EVALUATION_EVENT_TYPES.SCHEDULED;
export const EVALUATION_STARTED_EVENT_TYPE = EVALUATION_EVENT_TYPES.STARTED;
export const EVALUATION_COMPLETED_EVENT_TYPE = EVALUATION_EVENT_TYPES.COMPLETED;
export const EVALUATION_REPORTED_EVENT_TYPE = EVALUATION_EVENT_TYPES.REPORTED;
export const EVALUATION_ATTEMPT_FAILED_EVENT_TYPE = EVALUATION_EVENT_TYPES.ATTEMPT_FAILED;

/**
 * Event schema versions using calendar versioning (YYYY-MM-DD). When the schema
 * changes, consumers use versions to handle backwards compatibility.
 */
export const EVALUATION_EVENT_VERSIONS = {
  /** Initial schema version introduced with event sourcing feature */
  SCHEDULED: "2025-01-14",
  /** Initial schema version introduced with event sourcing feature */
  STARTED: "2025-01-14",
  /** Initial schema version introduced with event sourcing feature */
  COMPLETED: "2025-01-14",
  /** Initial schema version for single-event custom SDK evaluations */
  REPORTED: "2025-01-14",
  /** An attempt whose evaluator service was not up, with the next attempt it scheduled */
  ATTEMPT_FAILED: "2026-10-19",
} as const;

// Legacy exports for backwards compatibility
export const EVALUATION_SCHEDULED_EVENT_VERSION_LATEST = EVALUATION_EVENT_VERSIONS.SCHEDULED;
export const EVALUATION_STARTED_EVENT_VERSION_LATEST = EVALUATION_EVENT_VERSIONS.STARTED;
export const EVALUATION_COMPLETED_EVENT_VERSION_LATEST = EVALUATION_EVENT_VERSIONS.COMPLETED;
export const EVALUATION_REPORTED_EVENT_VERSION_LATEST = EVALUATION_EVENT_VERSIONS.REPORTED;
export const EVALUATION_ATTEMPT_FAILED_EVENT_VERSION_LATEST =
  EVALUATION_EVENT_VERSIONS.ATTEMPT_FAILED;

export const EVALUATION_PROCESSING_EVENT_TYPES = [
  EVALUATION_EVENT_TYPES.SCHEDULED,
  EVALUATION_EVENT_TYPES.STARTED,
  EVALUATION_EVENT_TYPES.COMPLETED,
  EVALUATION_EVENT_TYPES.REPORTED,
  EVALUATION_EVENT_TYPES.ATTEMPT_FAILED,
] as const;

export type EvaluationProcessingEventType = (typeof EVALUATION_PROCESSING_EVENT_TYPES)[number];

/**
 * Command type identifiers used for routing commands to handlers.
 * Format: "lw.<domain>.<action>"
 */
export const EVALUATION_COMMAND_TYPES = {
  EXECUTE: "lw.evaluation.execute",
  START: "lw.evaluation.start",
  COMPLETE: "lw.evaluation.complete",
  REPORT: "lw.evaluation.report",
} as const;

// Legacy exports for backwards compatibility
export const START_EVALUATION_COMMAND_TYPE = EVALUATION_COMMAND_TYPES.START;
export const COMPLETE_EVALUATION_COMMAND_TYPE = EVALUATION_COMMAND_TYPES.COMPLETE;

export const EXECUTE_EVALUATION_COMMAND_TYPE = EVALUATION_COMMAND_TYPES.EXECUTE;

export const REPORT_EVALUATION_COMMAND_TYPE = EVALUATION_COMMAND_TYPES.REPORT;

export const EVALUATION_PROCESSING_COMMAND_TYPES = [
  EVALUATION_COMMAND_TYPES.EXECUTE,
  EVALUATION_COMMAND_TYPES.START,
  EVALUATION_COMMAND_TYPES.COMPLETE,
  EVALUATION_COMMAND_TYPES.REPORT,
] as const;

export type EvaluationProcessingCommandType = (typeof EVALUATION_PROCESSING_COMMAND_TYPES)[number];

/**
 * Projection schema versions, calendar-versioned (YYYY-MM-DD). A change here
 * may require rebuilding projections from events to apply the new schema.
 */
export const EVALUATION_PROJECTION_VERSIONS = {
  /** Initial projection schema version */
  STATE: "2025-01-14",
} as const;

// Legacy export for backwards compatibility
export const EVALUATION_RUN_PROJECTION_VERSION_LATEST = EVALUATION_PROJECTION_VERSIONS.STATE;

export const EVALUATION_RUN_PROJECTION_VERSIONS = [EVALUATION_PROJECTION_VERSIONS.STATE] as const;
