import { z } from "zod";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
  SIMULATION_SET_EVENT_TYPES,
} from "./simulation-event.constants";
import {
  simulationEventMessageSchema,
  simulationEventResultsSchema,
} from "./simulation-event.values";

const runSecretCiphertextSchema = z.record(z.string(), z.string());

/** Portable event envelope owned by Simulation; Eventing consumes it structurally. */
export const simulationEventSchema = z.object({
  id: z.string(),
  aggregateId: z.string(),
  aggregateType: z.string().trim().min(1),
  tenantId: z.string().trim().min(1).brand<"TenantId">(),
  createdAt: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
  type: z.string().trim().min(1),
  version: z.string().date(),
  data: z.unknown(),
  metadata: z.object({ processingTraceparent: z.string().optional() }).passthrough().optional(),
  idempotencyKey: z.string().optional(),
});

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
  metadata: z.record(z.string(), z.unknown()).optional(),
  /**
   * The run's secret parameter values, encrypted, keyed by name.
   *
   * A sibling of `metadata`, not a member of it: the fold projection copies
   * the metadata object into the runs store, so a worker on an older build
   * would carry anything inside it into that store and a sibling is dropped
   * instead. The names, in clear, ride `metadata.secretParameterNames`.
   */
  secretParameters: runSecretCiphertextSchema.optional(),
  /** Target the event-driven execution runs against. */
  target: z
    .object({
      type: z.enum(["prompt", "http", "code", "workflow"]),
      referenceId: z.string(),
    })
    .optional(),
});
export type SimulationRunQueuedEventData = z.infer<typeof simulationRunQueuedEventDataSchema>;

export const SimulationRunQueuedEventSchema = simulationEventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.QUEUED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.QUEUED),
  data: simulationRunQueuedEventDataSchema,
});
export type SimulationRunQueuedEvent = z.infer<typeof SimulationRunQueuedEventSchema>;

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
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type SimulationRunStartedEventData = z.infer<typeof simulationRunStartedEventDataSchema>;

export const SimulationRunStartedEventSchema = simulationEventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.STARTED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.STARTED),
  data: simulationRunStartedEventDataSchema,
});
export type SimulationRunStartedEvent = z.infer<typeof SimulationRunStartedEventSchema>;

/**
 * MessageSnapshot event - emitted when simulation messages are updated.
 */
export const simulationMessageSnapshotEventDataSchema = z.object({
  scenarioRunId: z.string(),
  messages: z.array(simulationEventMessageSchema),
  traceIds: z.array(z.string()).default([]),
  status: z.string().optional(),
});
export type SimulationMessageSnapshotEventData = z.infer<
  typeof simulationMessageSnapshotEventDataSchema
>;

export const SimulationMessageSnapshotEventSchema = simulationEventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT),
  version: z.literal(SIMULATION_EVENT_VERSIONS.MESSAGE_SNAPSHOT),
  data: simulationMessageSnapshotEventDataSchema,
});
export type SimulationMessageSnapshotEvent = z.infer<typeof SimulationMessageSnapshotEventSchema>;

/**
 * RunFinished event - emitted when a simulation run completes.
 */
export const simulationRunFinishedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  results: simulationEventResultsSchema.optional(),
  durationMs: z.number().optional(),
  status: z.string().optional(),
  // Identity + traceIds are event-carried state (ECST) so downstream
  // subscribers never read fold state.
  //
  // Optional because the CALLER need not supply them — FinishRunCommand
  // backfills from the run's prior events when they are absent. Not for
  // backwards compatibility: this schema pins `version` to a literal, so an
  // event written under an older version fails that check before reaching
  // these fields at all.
  scenarioId: z.string().optional(),
  batchRunId: z.string().optional(),
  scenarioSetId: z.string().optional(),
  traceIds: z.array(z.string()).optional(),
});
export type SimulationRunFinishedEventData = z.infer<typeof simulationRunFinishedEventDataSchema>;

export const SimulationRunFinishedEventSchema = simulationEventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.FINISHED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.FINISHED),
  data: simulationRunFinishedEventDataSchema,
});
export type SimulationRunFinishedEvent = z.infer<typeof SimulationRunFinishedEventSchema>;

/**
 * TextMessageStart event - emitted when a message begins (placeholder).
 */
export const simulationTextMessageStartEventDataSchema = z.object({
  scenarioRunId: z.string(),
  messageId: z.string(),
  role: z.string(),
  messageIndex: z.number().optional(),
});
export type SimulationTextMessageStartEventData = z.infer<
  typeof simulationTextMessageStartEventDataSchema
>;

export const SimulationTextMessageStartEventSchema = simulationEventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_START),
  version: z.literal(SIMULATION_EVENT_VERSIONS.TEXT_MESSAGE_START),
  data: simulationTextMessageStartEventDataSchema,
});
export type SimulationTextMessageStartEvent = z.infer<typeof SimulationTextMessageStartEventSchema>;

/**
 * TextMessageEnd event - emitted when a message is complete with full content.
 */
export const simulationTextMessageEndEventDataSchema = z.object({
  scenarioRunId: z.string(),
  messageId: z.string(),
  role: z.string(),
  content: z.string(),
  message: z.record(z.string(), z.unknown()).optional(),
  traceId: z.string().optional(),
  messageIndex: z.number().optional(),
});
export type SimulationTextMessageEndEventData = z.infer<
  typeof simulationTextMessageEndEventDataSchema
>;

export const SimulationTextMessageEndEventSchema = simulationEventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END),
  version: z.literal(SIMULATION_EVENT_VERSIONS.TEXT_MESSAGE_END),
  data: simulationTextMessageEndEventDataSchema,
});
export type SimulationTextMessageEndEvent = z.infer<typeof SimulationTextMessageEndEventSchema>;

/**
 * MetricsComputed event - emitted when cost/latency metrics are computed from traces.
 * Carries per-trace metrics via ECST (Event-Carried State Transfer).
 */
export const simulationRunMetricsComputedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  traceId: z.string(),
  totalCost: z.number(),
  roleCosts: z.record(z.string(), z.number()),
  roleLatencies: z.record(z.string(), z.number()),
});
export type SimulationRunMetricsComputedEventData = z.infer<
  typeof simulationRunMetricsComputedEventDataSchema
>;

export const SimulationRunMetricsComputedEventSchema = simulationEventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.METRICS_COMPUTED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.METRICS_COMPUTED),
  data: simulationRunMetricsComputedEventDataSchema,
});
export type SimulationRunMetricsComputedEvent = z.infer<
  typeof SimulationRunMetricsComputedEventSchema
>;

/**
 * CancelRequested event - emitted when a user requests cancellation of a run.
 * Sets CancellationRequestedAt in the fold projection without changing Status.
 * The simulationRunExecution process manager's cancel intent broadcasts this
 * to all worker pods via Redis pub/sub.
 */
export const simulationRunCancelRequestedEventDataSchema = z.object({
  scenarioRunId: z.string(),
});
export type SimulationRunCancelRequestedEventData = z.infer<
  typeof simulationRunCancelRequestedEventDataSchema
>;

export const SimulationRunCancelRequestedEventSchema = simulationEventSchema.extend({
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
});
export type SimulationRunDeletedEventData = z.infer<typeof simulationRunDeletedEventDataSchema>;

export const SimulationRunDeletedEventSchema = simulationEventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.DELETED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.DELETED),
  data: simulationRunDeletedEventDataSchema,
});
export type SimulationRunDeletedEvent = z.infer<typeof SimulationRunDeletedEventSchema>;

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
export type SimulationSetArchivedEventData = z.infer<typeof simulationSetArchivedEventDataSchema>;

export const SimulationSetArchivedEventSchema = simulationEventSchema.extend({
  type: z.literal(SIMULATION_SET_EVENT_TYPES.ARCHIVED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.SET_ARCHIVED),
  data: simulationSetArchivedEventDataSchema,
});
export type SimulationSetArchivedEvent = z.infer<typeof SimulationSetArchivedEventSchema>;

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
  | SimulationRunCancelRequestedEvent
  | SimulationRunDeletedEvent
  | SimulationSetArchivedEvent;

export {
  isSimulationMessageSnapshotEvent,
  isSimulationRunCancelRequestedEvent,
  isSimulationRunDeletedEvent,
  isSimulationRunFinishedEvent,
  isSimulationRunMetricsComputedEvent,
  isSimulationRunQueuedEvent,
  isSimulationRunStartedEvent,
  isSimulationSetArchivedEvent,
  isSimulationTextMessageEndEvent,
  isSimulationTextMessageStartEvent,
} from "./simulation-event.guards";
