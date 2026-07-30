import {
  cancelRequestedDataSchema,
  messageSnapshotDataSchema,
  metricsRecordedDataSchema,
  runDeletedDataSchema,
  runFinishedDataSchema,
  runQueuedDataSchema,
  runStartedDataSchema,
  textMessageEndDataSchema,
  textMessageStartDataSchema,
} from "./schema";

/**
 * `prefix` keeps every derived type string byte-equal to the dotted forms
 * already in `event_log` (e.g. `lw.simulation_run.queued`).
 */
export const SIMULATION_RUN_PIPELINE_NAME = "simulation_run";
export const SIMULATION_RUN_PIPELINE_PREFIX = "lw";

/** The run's whole lifecycle vocabulary (ADR-105). State belongs to the fold
 * that accumulates it, not to this map. */
export const simulationRunEvents = {
  queued: runQueuedDataSchema,
  started: runStartedDataSchema,
  messageSnapshot: messageSnapshotDataSchema,
  textMessageStart: textMessageStartDataSchema,
  textMessageEnd: textMessageEndDataSchema,
  finished: runFinishedDataSchema,
  metricsRecorded: metricsRecordedDataSchema,
  cancelRequested: cancelRequestedDataSchema,
  deleted: runDeletedDataSchema,
} as const;
