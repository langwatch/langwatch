import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
  SIMULATION_SET_EVENT_TYPES,
} from "./constants";
import {
  runPlacementFields,
  simulationMessageSchema,
  simulationResultsSchema,
} from "./shared";

export type { SimulationRunStatus, SimulationVerdict } from "./shared";

/**
 * RunQueued event - emitted when a simulation run is scheduled but not yet started.
 */
export const simulationRunQueuedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  /** Target for execution. Added for event-driven execution (replaces BullMQ job data). */
  target: z
    .object({
      type: z.enum(["prompt", "http", "code", "workflow"]),
      referenceId: z.string(),
    })
    .optional(),
  /**
   * How many runs the dispatching batch intends to queue (ADR-103). Carried by
   * every child so the batch's denominator is known from the first row that
   * lands, instead of from a separate suite-run stream.
   *
   * Optional, and the field is additive rather than a version bump: the event
   * version is asserted with `z.literal`, so bumping it would stop every
   * already-committed `queued` event from parsing. Absent (pre-ADR-103 events)
   * folds to 0, which the read path reads as "count the rows".
   */
  batchTotal: z.number().int().nonnegative().optional(),
});

export const SimulationRunQueuedEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.QUEUED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.QUEUED),
  data: simulationRunQueuedEventDataSchema,
});
export type SimulationRunQueuedEvent = z.infer<
  typeof SimulationRunQueuedEventSchema
>;

/**
 * RunStarted event - emitted when a simulation run begins.
 */
export const simulationRunStartedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const SimulationRunStartedEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.STARTED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.STARTED),
  data: simulationRunStartedEventDataSchema,
});
export type SimulationRunStartedEvent = z.infer<
  typeof SimulationRunStartedEventSchema
>;

/**
 * MessageSnapshot event - emitted when simulation messages are updated.
 */
export const simulationMessageSnapshotEventDataSchema = z.object({
  scenarioRunId: z.string(),
  ...runPlacementFields,
  messages: z.array(simulationMessageSchema),
  traceIds: z.array(z.string()).default([]),
  status: z.string().optional(),
});

export const SimulationMessageSnapshotEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT),
  version: z.literal(SIMULATION_EVENT_VERSIONS.MESSAGE_SNAPSHOT),
  data: simulationMessageSnapshotEventDataSchema,
});
export type SimulationMessageSnapshotEvent = z.infer<
  typeof SimulationMessageSnapshotEventSchema
>;

/**
 * RunFinished event - emitted when a simulation run completes.
 */
export const simulationRunFinishedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  ...runPlacementFields,
  results: simulationResultsSchema.optional(),
  durationMs: z.number().optional(),
  status: z.string().optional(),
});

export const SimulationRunFinishedEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.FINISHED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.FINISHED),
  data: simulationRunFinishedEventDataSchema,
});
export type SimulationRunFinishedEvent = z.infer<
  typeof SimulationRunFinishedEventSchema
>;

/**
 * TextMessageStart event - emitted when a message begins (placeholder).
 */
export const simulationTextMessageStartEventDataSchema = z.object({
  scenarioRunId: z.string(),
  messageId: z.string(),
  role: z.string(),
  messageIndex: z.number().optional(),
});

export const SimulationTextMessageStartEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_START),
  version: z.literal(SIMULATION_EVENT_VERSIONS.TEXT_MESSAGE_START),
  data: simulationTextMessageStartEventDataSchema,
});
export type SimulationTextMessageStartEvent = z.infer<
  typeof SimulationTextMessageStartEventSchema
>;

/**
 * TextMessageEnd event - emitted when a message is complete with full content.
 */
export const simulationTextMessageEndEventDataSchema = z.object({
  scenarioRunId: z.string(),
  ...runPlacementFields,
  messageId: z.string(),
  role: z.string(),
  content: z.string(),
  message: z.record(z.unknown()).optional(),
  traceId: z.string().optional(),
  messageIndex: z.number().optional(),
});

export const SimulationTextMessageEndEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END),
  version: z.literal(SIMULATION_EVENT_VERSIONS.TEXT_MESSAGE_END),
  data: simulationTextMessageEndEventDataSchema,
});
export type SimulationTextMessageEndEvent = z.infer<
  typeof SimulationTextMessageEndEventSchema
>;

/**
 * RETIRED per-trace metrics event. Nothing emits it and no projection folds it;
 * it survives only so events already in the log still parse. See
 * {@link SIMULATION_RUN_EVENT_TYPES.METRICS_COMPUTED}.
 *
 * It was emitted once per (run, trace) under an idempotency key that was
 * constant across recomputes, so the event store's keep-the-first rule froze
 * whatever the first attempt saw — including the zeroes it emitted while cost
 * enrichment was still in flight. Its fold also carried an unbounded
 * `traceId -> metrics` map on the run to re-aggregate from. Superseded by
 * {@link SimulationRunMetricsRecordedEventSchema}.
 */
export const simulationRunMetricsComputedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  traceId: z.string(),
  totalCost: z.number(),
  roleCosts: z.record(z.string(), z.number()),
  roleLatencies: z.record(z.string(), z.number()),
});

export const SimulationRunMetricsComputedEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.METRICS_COMPUTED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.METRICS_COMPUTED),
  data: simulationRunMetricsComputedEventDataSchema,
});
export type SimulationRunMetricsComputedEvent = z.infer<
  typeof SimulationRunMetricsComputedEventSchema
>;

/**
 * MetricsRecorded event — the whole run's cost and latency, computed once from
 * every trace it produced, after the run has finished and its spans have
 * settled.
 *
 * The values are carried on the event rather than looked up at read time on
 * purpose: `stored_spans` and `trace_summaries` live in the `traces` retention
 * category while `simulation_runs` lives in `scenarios`, and the two are
 * independently configurable — so spans can expire out from under a run that is
 * still displayed. Carrying the numbers means a replay reproduces them from the
 * log alone.
 *
 * The fold assigns these fields wholesale, so a later recompute simply replaces
 * an earlier one: there is no accumulator to keep, and nothing to unwind.
 */
export const simulationRunMetricsRecordedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  /** Traces the values below were aggregated over. */
  traceIds: z.array(z.string()),
  /** Summed cost across those traces; null when none of them reported one. */
  totalCost: z.number().nullable(),
  /** Per-role cost, one array entry per contributing trace. */
  roleCosts: z.record(z.string(), z.array(z.number())),
  /** Per-role latency in ms, one array entry per contributing trace. */
  roleLatencies: z.record(z.string(), z.array(z.number())),
});
export type SimulationRunMetricsRecordedEventData = z.infer<
  typeof simulationRunMetricsRecordedEventDataSchema
>;

export const SimulationRunMetricsRecordedEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.METRICS_RECORDED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.METRICS_RECORDED),
  data: simulationRunMetricsRecordedEventDataSchema,
});
export type SimulationRunMetricsRecordedEvent = z.infer<
  typeof SimulationRunMetricsRecordedEventSchema
>;

/**
 * CancelRequested event - emitted when a user requests cancellation of a run.
 * Sets CancellationRequestedAt in the fold projection without changing Status.
 * The `cancellationBroadcast` subscriber broadcasts it to all worker pods via
 * Redis pub/sub.
 */
export const simulationRunCancelRequestedEventDataSchema = z.object({
  scenarioRunId: z.string(),
});

export const SimulationRunCancelRequestedEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.CANCEL_REQUESTED),
  data: simulationRunCancelRequestedEventDataSchema,
});
export type SimulationRunCancelRequestedEvent = z.infer<
  typeof SimulationRunCancelRequestedEventSchema
>;

/**
 * RunDeleted event - emitted when a simulation run is soft-deleted.
 */
export const simulationRunDeletedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  ...runPlacementFields,
});

export const SimulationRunDeletedEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.DELETED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.DELETED),
  data: simulationRunDeletedEventDataSchema,
});
export type SimulationRunDeletedEvent = z.infer<
  typeof SimulationRunDeletedEventSchema
>;

/**
 * SetArchived event — emitted when a user archives a whole scenario set.
 * One user intent → one event carrying the affected runs, instead of N
 * independent `lw.simulation_run.deleted` events.
 *
 * Aggregate is the set (`scenarioSetId`). The fold projection for
 * `simulation_run` aggregates is currently per-run; wiring this event
 * through the dispatcher fan-out is tracked separately — see lw#3636.
 *
 * Idempotency keys on `(tenantId, scenarioSetId)` so that retrying the
 * same archive request collapses into a single event.
 */
export const simulationSetArchivedEventDataSchema = z.object({
  scenarioSetId: z.string(),
  /**
   * Runs that belonged to the set at archive time. Snapshotted into the
   * payload so replay produces the same projection state regardless of
   * later run inserts/deletes.
   */
  scenarioRunIds: z.array(z.string()).min(1),
});

export const SimulationSetArchivedEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_SET_EVENT_TYPES.ARCHIVED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.SET_ARCHIVED),
  data: simulationSetArchivedEventDataSchema,
});
export type SimulationSetArchivedEvent = z.infer<
  typeof SimulationSetArchivedEventSchema
>;

/**
 * Union of all simulation processing event types.
 */
export type SimulationProcessingEvent =
  | SimulationRunQueuedEvent
  | SimulationRunStartedEvent
  | SimulationMessageSnapshotEvent
  | SimulationTextMessageStartEvent
  | SimulationTextMessageEndEvent
  | SimulationRunFinishedEvent
  | SimulationRunMetricsComputedEvent
  | SimulationRunMetricsRecordedEvent
  | SimulationRunCancelRequestedEvent
  | SimulationRunDeletedEvent
  | SimulationSetArchivedEvent;

export {
  isSimulationMessageSnapshotEvent,
  isSimulationRunCancelRequestedEvent,
  isSimulationRunDeletedEvent,
  isSimulationRunFinishedEvent,
  isSimulationRunMetricsRecordedEvent,
  isSimulationRunQueuedEvent,
  isSimulationRunStartedEvent,
  isSimulationSetArchivedEvent,
  isSimulationTextMessageEndEvent,
  isSimulationTextMessageStartEvent,
} from "./typeGuards";
