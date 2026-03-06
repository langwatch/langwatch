/**
 * Event and command type constants for the suite-run-processing pipeline.
 */

/**
 * Event type identifiers used for routing and filtering events.
 * Format: "lw.suite_run.<action>"
 */
export const SUITE_RUN_EVENT_TYPES = {
  STARTED: "lw.suite_run.started",
  SCENARIO_STARTED: "lw.suite_run.scenario_started",
  SCENARIO_RESULT: "lw.suite_run.scenario_result",
  COMPLETED: "lw.suite_run.completed",
} as const;

export const SUITE_RUN_PROCESSING_EVENT_TYPES = [
  SUITE_RUN_EVENT_TYPES.STARTED,
  SUITE_RUN_EVENT_TYPES.SCENARIO_STARTED,
  SUITE_RUN_EVENT_TYPES.SCENARIO_RESULT,
  SUITE_RUN_EVENT_TYPES.COMPLETED,
] as const;

export type SuiteRunProcessingEventType =
  (typeof SUITE_RUN_PROCESSING_EVENT_TYPES)[number];

/**
 * Command type identifiers used for routing commands to handlers.
 * Format: "lw.suite_run.<action>"
 */
export const SUITE_RUN_COMMAND_TYPES = {
  START: "lw.suite_run.start",
  START_SCENARIO: "lw.suite_run.start_scenario",
  RECORD_SCENARIO_RESULT: "lw.suite_run.record_scenario_result",
} as const;

export const SUITE_RUN_PROCESSING_COMMAND_TYPES = [
  SUITE_RUN_COMMAND_TYPES.START,
  SUITE_RUN_COMMAND_TYPES.START_SCENARIO,
  SUITE_RUN_COMMAND_TYPES.RECORD_SCENARIO_RESULT,
] as const;

export type SuiteRunProcessingCommandType =
  (typeof SUITE_RUN_PROCESSING_COMMAND_TYPES)[number];

/**
 * Event schema versions using calendar versioning (YYYY-MM-DD).
 */
export const SUITE_RUN_EVENT_VERSIONS = {
  STARTED: "2026-03-01",
  SCENARIO_STARTED: "2026-03-06",
  SCENARIO_RESULT: "2026-03-01",
  COMPLETED: "2026-03-01",
} as const;

/**
 * Projection schema versions using calendar versioning (YYYY-MM-DD).
 */
export const SUITE_RUN_PROJECTION_VERSIONS = {
  RUN_STATE: "2026-03-01",
  RUN_ITEMS: "2026-03-06",
} as const;
