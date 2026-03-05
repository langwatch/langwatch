/**
 * Event and command type constants for the simulation-processing pipeline.
 */

/**
 * Event type identifiers used for routing and filtering events.
 * Format: "lw.simulation_run.<action>"
 */
export const SIMULATION_RUN_EVENT_TYPES = {
  STARTED: "lw.simulation_run.started",
  MESSAGE_SNAPSHOT: "lw.simulation_run.message_snapshot",
  FINISHED: "lw.simulation_run.finished",
  DELETED: "lw.simulation_run.deleted",
} as const;

export const SIMULATION_PROCESSING_EVENT_TYPES = [
  SIMULATION_RUN_EVENT_TYPES.STARTED,
  SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
  SIMULATION_RUN_EVENT_TYPES.FINISHED,
  SIMULATION_RUN_EVENT_TYPES.DELETED,
] as const;

export type SimulationProcessingEventType =
  (typeof SIMULATION_PROCESSING_EVENT_TYPES)[number];

/**
 * Command type identifiers used for routing commands to handlers.
 * Format: "lw.simulation_run.<action>"
 */
export const SIMULATION_RUN_COMMAND_TYPES = {
  START: "lw.simulation_run.start",
  MESSAGE_SNAPSHOT: "lw.simulation_run.message_snapshot",
  FINISH: "lw.simulation_run.finish",
  DELETE: "lw.simulation_run.delete",
} as const;

export const SIMULATION_RUN_PROCESSING_COMMAND_TYPES = [
  SIMULATION_RUN_COMMAND_TYPES.START,
  SIMULATION_RUN_COMMAND_TYPES.MESSAGE_SNAPSHOT,
  SIMULATION_RUN_COMMAND_TYPES.FINISH,
  SIMULATION_RUN_COMMAND_TYPES.DELETE,
] as const;

export type SimulationProcessingCommandType =
  (typeof SIMULATION_RUN_PROCESSING_COMMAND_TYPES)[number];

/**
 * Event schema versions using calendar versioning (YYYY-MM-DD).
 */
export const SIMULATION_EVENT_VERSIONS = {
  STARTED: "2026-02-01",
  MESSAGE_SNAPSHOT: "2026-02-01",
  FINISHED: "2026-02-01",
  DELETED: "2026-02-01",
} as const;

/**
 * Projection schema versions using calendar versioning (YYYY-MM-DD).
 */
export const SIMULATION_PROJECTION_VERSIONS = {
  RUN_STATE: "2026-02-01",
} as const;
