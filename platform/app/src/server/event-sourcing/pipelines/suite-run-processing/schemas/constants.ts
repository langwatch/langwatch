/**
 * Event and command type constants for the suite-run-processing pipeline.
 */

/**
 * Event type identifiers used for routing and filtering events.
 * Format: "lw.suite_run.<action>"
 */
export const SUITE_RUN_EVENT_TYPES = {
  STARTED: "lw.suite_run.started",
  ITEM_STARTED: "lw.suite_run.item_started",
  ITEM_COMPLETED: "lw.suite_run.item_completed",
} as const;

export const SUITE_RUN_PROCESSING_EVENT_TYPES = [
  SUITE_RUN_EVENT_TYPES.STARTED,
  SUITE_RUN_EVENT_TYPES.ITEM_STARTED,
  SUITE_RUN_EVENT_TYPES.ITEM_COMPLETED,
] as const;

export type SuiteRunProcessingEventType =
  (typeof SUITE_RUN_PROCESSING_EVENT_TYPES)[number];

/**
 * Command type identifiers used for routing commands to handlers.
 * Format: "lw.suite_run.<action>"
 */
export const SUITE_RUN_COMMAND_TYPES = {
  START: "lw.suite_run.start",
  RECORD_ITEM_STARTED: "lw.suite_run.record_item_started",
  COMPLETE_ITEM: "lw.suite_run.complete_item",
} as const;

export const SUITE_RUN_PROCESSING_COMMAND_TYPES = [
  SUITE_RUN_COMMAND_TYPES.START,
  SUITE_RUN_COMMAND_TYPES.RECORD_ITEM_STARTED,
  SUITE_RUN_COMMAND_TYPES.COMPLETE_ITEM,
] as const;

export type SuiteRunProcessingCommandType =
  (typeof SUITE_RUN_PROCESSING_COMMAND_TYPES)[number];

/**
 * Event schema versions using calendar versioning (YYYY-MM-DD).
 */
export const SUITE_RUN_EVENT_VERSIONS = {
  STARTED: "2026-03-01",
  ITEM_STARTED: "2026-03-01",
  ITEM_COMPLETED: "2026-03-01",
} as const;

/**
 * Projection schema versions using calendar versioning (YYYY-MM-DD).
 */
export const SUITE_RUN_PROJECTION_VERSIONS = {
  RUN_STATE: "2026-03-01",
} as const;
