/**
 * Event and command type constants for the simulation-processing pipeline.
 */

/**
 * Event type identifiers used for routing and filtering events.
 * Format: "lw.simulation.<action>"
 */
export const SIMULATION_EVENT_TYPES = {
  RUN_STARTED: "lw.simulation.run_started",
  MESSAGE_SNAPSHOT: "lw.simulation.message_snapshot",
  RUN_FINISHED: "lw.simulation.run_finished",
  RUN_DELETED: "lw.simulation.run_deleted",
} as const;

/**
 * Event schema versions using calendar versioning (YYYY-MM-DD).
 */
export const SIMULATION_EVENT_VERSIONS = {
  RUN_STARTED: "2026-02-01",
  MESSAGE_SNAPSHOT: "2026-02-01",
  RUN_FINISHED: "2026-02-01",
  RUN_DELETED: "2026-02-01",
} as const;

export const SIMULATION_PROCESSING_EVENT_TYPES = [
  SIMULATION_EVENT_TYPES.RUN_STARTED,
  SIMULATION_EVENT_TYPES.MESSAGE_SNAPSHOT,
  SIMULATION_EVENT_TYPES.RUN_FINISHED,
  SIMULATION_EVENT_TYPES.RUN_DELETED,
] as const;

export type SimulationProcessingEventType =
  (typeof SIMULATION_PROCESSING_EVENT_TYPES)[number];

/**
 * Command type identifiers used for routing commands to handlers.
 * Format: "lw.simulation.<action>"
 */
export const SIMULATION_COMMAND_TYPES = {
  START_RUN: "lw.simulation.start_run",
  MESSAGE_SNAPSHOT: "lw.simulation.message_snapshot",
  FINISH_RUN: "lw.simulation.finish_run",
  DELETE_RUN: "lw.simulation.delete_run",
} as const;

export const SIMULATION_PROCESSING_COMMAND_TYPES = [
  SIMULATION_COMMAND_TYPES.START_RUN,
  SIMULATION_COMMAND_TYPES.MESSAGE_SNAPSHOT,
  SIMULATION_COMMAND_TYPES.FINISH_RUN,
  SIMULATION_COMMAND_TYPES.DELETE_RUN,
] as const;

export type SimulationProcessingCommandType =
  (typeof SIMULATION_PROCESSING_COMMAND_TYPES)[number];

/**
 * Projection schema versions using calendar versioning (YYYY-MM-DD).
 */
export const SIMULATION_PROJECTION_VERSIONS = {
  RUN_STATE: "2026-02-01",
} as const;
