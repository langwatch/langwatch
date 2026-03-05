/**
 * Event and command type constants for the evaluation-processing pipeline.
 */

/**
 * Event type identifiers used for routing and filtering events.
 * Format: "lw.<domain>.<action>"
 */
export const EVALUATION_EVENT_TYPES = {
  SCHEDULED: "lw.evaluation.scheduled",
  STARTED: "lw.evaluation.started",
  COMPLETED: "lw.evaluation.completed",
} as const;

// Legacy exports for backwards compatibility
export const EVALUATION_SCHEDULED_EVENT_TYPE = EVALUATION_EVENT_TYPES.SCHEDULED;
export const EVALUATION_STARTED_EVENT_TYPE = EVALUATION_EVENT_TYPES.STARTED;
export const EVALUATION_COMPLETED_EVENT_TYPE = EVALUATION_EVENT_TYPES.COMPLETED;

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
export const EVALUATION_EVENT_VERSIONS = {
  /** Initial schema version introduced with event sourcing feature */
  SCHEDULED: "2025-01-14",
  /** Initial schema version introduced with event sourcing feature */
  STARTED: "2025-01-14",
  /** Initial schema version introduced with event sourcing feature */
  COMPLETED: "2025-01-14",
} as const;

// Legacy exports for backwards compatibility
export const EVALUATION_SCHEDULED_EVENT_VERSION_LATEST =
  EVALUATION_EVENT_VERSIONS.SCHEDULED;
export const EVALUATION_STARTED_EVENT_VERSION_LATEST =
  EVALUATION_EVENT_VERSIONS.STARTED;
export const EVALUATION_COMPLETED_EVENT_VERSION_LATEST =
  EVALUATION_EVENT_VERSIONS.COMPLETED;

export const EVALUATION_PROCESSING_EVENT_TYPES = [
  EVALUATION_EVENT_TYPES.SCHEDULED,
  EVALUATION_EVENT_TYPES.STARTED,
  EVALUATION_EVENT_TYPES.COMPLETED,
] as const;

export type EvaluationProcessingEventType =
  (typeof EVALUATION_PROCESSING_EVENT_TYPES)[number];

/**
 * Command type identifiers used for routing commands to handlers.
 * Format: "lw.<domain>.<action>"
 */
export const EVALUATION_COMMAND_TYPES = {
  EXECUTE: "lw.evaluation.execute",
  START: "lw.evaluation.start",
  COMPLETE: "lw.evaluation.complete",
} as const;

// Legacy exports for backwards compatibility
export const START_EVALUATION_COMMAND_TYPE = EVALUATION_COMMAND_TYPES.START;
export const COMPLETE_EVALUATION_COMMAND_TYPE =
  EVALUATION_COMMAND_TYPES.COMPLETE;

export const EXECUTE_EVALUATION_COMMAND_TYPE =
  EVALUATION_COMMAND_TYPES.EXECUTE;

export const EVALUATION_PROCESSING_COMMAND_TYPES = [
  EVALUATION_COMMAND_TYPES.EXECUTE,
  EVALUATION_COMMAND_TYPES.START,
  EVALUATION_COMMAND_TYPES.COMPLETE,
] as const;

export type EvaluationProcessingCommandType =
  (typeof EVALUATION_PROCESSING_COMMAND_TYPES)[number];

/**
 * Projection schema versions using calendar versioning (YYYY-MM-DD).
 *
 * These versions indicate the schema version of the projection data structure.
 * When the projection schema changes, projections may need to be rebuilt from
 * events to apply the new schema.
 */
export const EVALUATION_PROJECTION_VERSIONS = {
  /** Initial projection schema version */
  STATE: "2025-01-14",
} as const;

// Legacy export for backwards compatibility
export const EVALUATION_RUN_PROJECTION_VERSION_LATEST =
  EVALUATION_PROJECTION_VERSIONS.STATE;

export const EVALUATION_RUN_PROJECTION_VERSIONS = [
  EVALUATION_PROJECTION_VERSIONS.STATE,
] as const;
