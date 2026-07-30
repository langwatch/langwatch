/**
 * Event and command type constants for the simulation-processing pipeline.
 */

/**
 * Event type identifiers used for routing and filtering events.
 * Format: "lw.simulation_run.<action>"
 */
export const SIMULATION_RUN_EVENT_TYPES = {
  QUEUED: "lw.simulation_run.queued",
  STARTED: "lw.simulation_run.started",
  MESSAGE_SNAPSHOT: "lw.simulation_run.message_snapshot",
  TEXT_MESSAGE_START: "lw.simulation_run.text_message_start",
  TEXT_MESSAGE_END: "lw.simulation_run.text_message_end",
  FINISHED: "lw.simulation_run.finished",
  DELETED: "lw.simulation_run.deleted",
  /**
   * RETIRED — nothing emits this any more, and no projection folds it.
   *
   * It was the per-trace metrics event, one per (run, trace), whose fold kept an
   * unbounded `traceId -> metrics` map on the run so it could re-aggregate. It
   * is kept registered because the identifier list feeds
   * `EventTypeSchema` (a `z.enum`), and events already committed under this type
   * must still parse when the log is read. Delete it only once no log within
   * retention can contain one.
   */
  METRICS_COMPUTED: "lw.simulation_run.metrics_computed",
  /**
   * The run's cost/latency, computed once from all of its traces after it
   * finished. Carries the aggregated values, so a replay rebuilds them from the
   * log without reading spans back — which matters because spans live in the
   * `traces` retention category and can expire while the run does not.
   */
  METRICS_RECORDED: "lw.simulation_run.metrics_recorded",
  CANCEL_REQUESTED: "lw.simulation_run.cancel_requested",
} as const;

/**
 * Set-scoped events. The set is the aggregate; payloads reference the
 * runs the action applies to. See lw#3636.
 */
export const SIMULATION_SET_EVENT_TYPES = {
  ARCHIVED: "lw.simulation_set.archived",
} as const;

export const SIMULATION_PROCESSING_EVENT_TYPES = [
  SIMULATION_RUN_EVENT_TYPES.QUEUED,
  SIMULATION_RUN_EVENT_TYPES.STARTED,
  SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
  SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_START,
  SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END,
  SIMULATION_RUN_EVENT_TYPES.FINISHED,
  SIMULATION_RUN_EVENT_TYPES.DELETED,
  SIMULATION_RUN_EVENT_TYPES.METRICS_COMPUTED,
  SIMULATION_RUN_EVENT_TYPES.METRICS_RECORDED,
  SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED,
  SIMULATION_SET_EVENT_TYPES.ARCHIVED,
] as const;

/**
 * Command type identifiers used for routing commands to handlers.
 * Format: "lw.simulation_run.<action>"
 */
export const SIMULATION_RUN_COMMAND_TYPES = {
  QUEUE: "lw.simulation_run.queue",
  START: "lw.simulation_run.start",
  MESSAGE_SNAPSHOT: "lw.simulation_run.message_snapshot",
  TEXT_MESSAGE_START: "lw.simulation_run.text_message_start",
  TEXT_MESSAGE_END: "lw.simulation_run.text_message_end",
  FINISH: "lw.simulation_run.finish",
  DELETE: "lw.simulation_run.delete",
  COMPUTE_METRICS: "lw.simulation_run.compute_metrics",
  CANCEL: "lw.simulation_run.cancel",
} as const;

const SIMULATION_SET_COMMAND_TYPES = {
  ARCHIVE: "lw.simulation_set.archive",
} as const;

export const SIMULATION_RUN_PROCESSING_COMMAND_TYPES = [
  SIMULATION_RUN_COMMAND_TYPES.QUEUE,
  SIMULATION_RUN_COMMAND_TYPES.START,
  SIMULATION_RUN_COMMAND_TYPES.MESSAGE_SNAPSHOT,
  SIMULATION_RUN_COMMAND_TYPES.TEXT_MESSAGE_START,
  SIMULATION_RUN_COMMAND_TYPES.TEXT_MESSAGE_END,
  SIMULATION_RUN_COMMAND_TYPES.FINISH,
  SIMULATION_RUN_COMMAND_TYPES.DELETE,
  SIMULATION_RUN_COMMAND_TYPES.COMPUTE_METRICS,
  SIMULATION_RUN_COMMAND_TYPES.CANCEL,
  SIMULATION_SET_COMMAND_TYPES.ARCHIVE,
] as const;

/**
 * Event schema versions using calendar versioning (YYYY-MM-DD).
 */
export const SIMULATION_EVENT_VERSIONS = {
  QUEUED: "2026-03-08",
  STARTED: "2026-02-01",
  MESSAGE_SNAPSHOT: "2026-02-01",
  TEXT_MESSAGE_START: "2026-02-01",
  TEXT_MESSAGE_END: "2026-02-01",
  FINISHED: "2026-02-01",
  DELETED: "2026-02-01",
  /** Retired alongside {@link SIMULATION_RUN_EVENT_TYPES.METRICS_COMPUTED}. */
  METRICS_COMPUTED: "2026-03-27",
  METRICS_RECORDED: "2026-07-29",
  CANCEL_REQUESTED: "2026-04-06",
  SET_ARCHIVED: "2026-05-04",
} as const;

/**
 * Projection schema versions using calendar versioning (YYYY-MM-DD).
 */
export const SIMULATION_PROJECTION_VERSIONS = {
  RUN_STATE: "2026-02-01",
} as const;
