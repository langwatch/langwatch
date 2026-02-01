/**
 * Event and command type constants for the batch-evaluation-processing pipeline.
 */

/**
 * Event type identifiers used for routing and filtering events.
 * Format: "lw.<domain>.<action>"
 */
export const BATCH_EVALUATION_EVENT_TYPES = {
  STARTED: "lw.batch-evaluation.started",
  TARGET_RESULT_RECEIVED: "lw.batch-evaluation.target-result-received",
  EVALUATOR_RESULT_RECEIVED: "lw.batch-evaluation.evaluator-result-received",
  COMPLETED: "lw.batch-evaluation.completed",
} as const;

// Legacy exports for backwards compatibility
export const BATCH_EVALUATION_STARTED_EVENT_TYPE =
  BATCH_EVALUATION_EVENT_TYPES.STARTED;
export const TARGET_RESULT_RECEIVED_EVENT_TYPE =
  BATCH_EVALUATION_EVENT_TYPES.TARGET_RESULT_RECEIVED;
export const EVALUATOR_RESULT_RECEIVED_EVENT_TYPE =
  BATCH_EVALUATION_EVENT_TYPES.EVALUATOR_RESULT_RECEIVED;
export const BATCH_EVALUATION_COMPLETED_EVENT_TYPE =
  BATCH_EVALUATION_EVENT_TYPES.COMPLETED;

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
export const BATCH_EVALUATION_EVENT_VERSIONS = {
  /** Initial schema version for batch evaluation processing */
  STARTED: "2025-02-01",
  /** Initial schema version for batch evaluation processing */
  TARGET_RESULT_RECEIVED: "2025-02-01",
  /** Initial schema version for batch evaluation processing */
  EVALUATOR_RESULT_RECEIVED: "2025-02-01",
  /** Initial schema version for batch evaluation processing */
  COMPLETED: "2025-02-01",
} as const;

// Legacy exports for backwards compatibility
export const BATCH_EVALUATION_STARTED_EVENT_VERSION_LATEST =
  BATCH_EVALUATION_EVENT_VERSIONS.STARTED;
export const TARGET_RESULT_RECEIVED_EVENT_VERSION_LATEST =
  BATCH_EVALUATION_EVENT_VERSIONS.TARGET_RESULT_RECEIVED;
export const EVALUATOR_RESULT_RECEIVED_EVENT_VERSION_LATEST =
  BATCH_EVALUATION_EVENT_VERSIONS.EVALUATOR_RESULT_RECEIVED;
export const BATCH_EVALUATION_COMPLETED_EVENT_VERSION_LATEST =
  BATCH_EVALUATION_EVENT_VERSIONS.COMPLETED;

export const BATCH_EVALUATION_PROCESSING_EVENT_TYPES = [
  BATCH_EVALUATION_EVENT_TYPES.STARTED,
  BATCH_EVALUATION_EVENT_TYPES.TARGET_RESULT_RECEIVED,
  BATCH_EVALUATION_EVENT_TYPES.EVALUATOR_RESULT_RECEIVED,
  BATCH_EVALUATION_EVENT_TYPES.COMPLETED,
] as const;

export type BatchEvaluationProcessingEventType =
  (typeof BATCH_EVALUATION_PROCESSING_EVENT_TYPES)[number];

/**
 * Command type identifiers used for routing commands to handlers.
 * Format: "lw.<domain>.<action>"
 */
export const BATCH_EVALUATION_COMMAND_TYPES = {
  START: "lw.batch-evaluation.start",
  RECORD_TARGET_RESULT: "lw.batch-evaluation.record-target-result",
  RECORD_EVALUATOR_RESULT: "lw.batch-evaluation.record-evaluator-result",
  COMPLETE: "lw.batch-evaluation.complete",
} as const;

// Legacy exports for backwards compatibility
export const START_BATCH_EVALUATION_COMMAND_TYPE =
  BATCH_EVALUATION_COMMAND_TYPES.START;
export const RECORD_TARGET_RESULT_COMMAND_TYPE =
  BATCH_EVALUATION_COMMAND_TYPES.RECORD_TARGET_RESULT;
export const RECORD_EVALUATOR_RESULT_COMMAND_TYPE =
  BATCH_EVALUATION_COMMAND_TYPES.RECORD_EVALUATOR_RESULT;
export const COMPLETE_BATCH_EVALUATION_COMMAND_TYPE =
  BATCH_EVALUATION_COMMAND_TYPES.COMPLETE;

export const BATCH_EVALUATION_PROCESSING_COMMAND_TYPES = [
  BATCH_EVALUATION_COMMAND_TYPES.START,
  BATCH_EVALUATION_COMMAND_TYPES.RECORD_TARGET_RESULT,
  BATCH_EVALUATION_COMMAND_TYPES.RECORD_EVALUATOR_RESULT,
  BATCH_EVALUATION_COMMAND_TYPES.COMPLETE,
] as const;

export type BatchEvaluationProcessingCommandType =
  (typeof BATCH_EVALUATION_PROCESSING_COMMAND_TYPES)[number];

/**
 * Projection schema versions using calendar versioning (YYYY-MM-DD).
 *
 * These versions indicate the schema version of the projection data structure.
 * When the projection schema changes, projections may need to be rebuilt from
 * events to apply the new schema.
 */
export const BATCH_EVALUATION_PROJECTION_VERSIONS = {
  /** Initial projection schema version */
  RUN_STATE: "2025-02-01",
} as const;

// Legacy export for backwards compatibility
export const BATCH_EVALUATION_RUN_STATE_PROJECTION_VERSION_LATEST =
  BATCH_EVALUATION_PROJECTION_VERSIONS.RUN_STATE;

export const BATCH_EVALUATION_RUN_STATE_PROJECTION_VERSIONS = [
  BATCH_EVALUATION_PROJECTION_VERSIONS.RUN_STATE,
] as const;

/**
 * KSUID resource identifier for batch evaluation results.
 * Used to generate deterministic, K-sortable IDs.
 * Format: lowercase letters only (a-z), no underscores.
 */
export const BATCH_RESULT_KSUID_RESOURCE = "batchresult" as const;
