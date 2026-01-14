/**
 * Event and command type constants for the evaluation-processing pipeline.
 */

// Event types
export const EVALUATION_SCHEDULED_EVENT_TYPE =
  "lw.evaluation.scheduled" as const;
export const EVALUATION_STARTED_EVENT_TYPE = "lw.evaluation.started" as const;
export const EVALUATION_COMPLETED_EVENT_TYPE =
  "lw.evaluation.completed" as const;

export const EVALUATION_SCHEDULED_EVENT_VERSION_LATEST = "2025-01-14" as const;
export const EVALUATION_STARTED_EVENT_VERSION_LATEST = "2025-01-14" as const;
export const EVALUATION_COMPLETED_EVENT_VERSION_LATEST = "2025-01-14" as const;

export const EVALUATION_PROCESSING_EVENT_TYPES = [
  EVALUATION_SCHEDULED_EVENT_TYPE,
  EVALUATION_STARTED_EVENT_TYPE,
  EVALUATION_COMPLETED_EVENT_TYPE,
] as const;

export type EvaluationProcessingEventType =
  (typeof EVALUATION_PROCESSING_EVENT_TYPES)[number];

// Command types
export const SCHEDULE_EVALUATION_COMMAND_TYPE =
  "lw.evaluation.schedule" as const;
export const START_EVALUATION_COMMAND_TYPE = "lw.evaluation.start" as const;
export const COMPLETE_EVALUATION_COMMAND_TYPE =
  "lw.evaluation.complete" as const;

export const EVALUATION_PROCESSING_COMMAND_TYPES = [
  SCHEDULE_EVALUATION_COMMAND_TYPE,
  START_EVALUATION_COMMAND_TYPE,
  COMPLETE_EVALUATION_COMMAND_TYPE,
] as const;

export type EvaluationProcessingCommandType =
  (typeof EVALUATION_PROCESSING_COMMAND_TYPES)[number];

// Projection version
export const EVALUATION_STATE_PROJECTION_VERSION_LATEST = "2025-01-14" as const;

export const EVALUATION_STATE_PROJECTION_VERSIONS = [
  EVALUATION_STATE_PROJECTION_VERSION_LATEST,
] as const;
