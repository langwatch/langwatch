import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import { SIMULATION_EVENT_VERSIONS, SIMULATION_RUN_EVENT_TYPES } from "./constants";
import { simulationMessageSchema, simulationResultsSchema } from "./shared";
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
  target: z.object({
    type: z.enum(["prompt", "http", "code", "workflow"]),
    referenceId: z.string(),
  }).optional(),
});
export type SimulationRunQueuedEventData = z.infer<typeof simulationRunQueuedEventDataSchema>;

export const SimulationRunQueuedEventSchema = EventSchema.extend({
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
  metadata: z.record(z.unknown()).optional(),
});
export type SimulationRunStartedEventData = z.infer<typeof simulationRunStartedEventDataSchema>;

export const SimulationRunStartedEventSchema = EventSchema.extend({
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
  messages: z.array(simulationMessageSchema),
  traceIds: z.array(z.string()).default([]),
  status: z.string().optional(),
});
export type SimulationMessageSnapshotEventData = z.infer<typeof simulationMessageSnapshotEventDataSchema>;

export const SimulationMessageSnapshotEventSchema = EventSchema.extend({
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
  results: simulationResultsSchema.optional(),
  durationMs: z.number().optional(),
  status: z.string().optional(),
});
export type SimulationRunFinishedEventData = z.infer<typeof simulationRunFinishedEventDataSchema>;

export const SimulationRunFinishedEventSchema = EventSchema.extend({
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
export type SimulationTextMessageStartEventData = z.infer<typeof simulationTextMessageStartEventDataSchema>;

export const SimulationTextMessageStartEventSchema = EventSchema.extend({
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
  message: z.record(z.unknown()).optional(),
  traceId: z.string().optional(),
  messageIndex: z.number().optional(),
});
export type SimulationTextMessageEndEventData = z.infer<typeof simulationTextMessageEndEventDataSchema>;

export const SimulationTextMessageEndEventSchema = EventSchema.extend({
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
export type SimulationRunMetricsComputedEventData = z.infer<typeof simulationRunMetricsComputedEventDataSchema>;

export const SimulationRunMetricsComputedEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.METRICS_COMPUTED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.METRICS_COMPUTED),
  data: simulationRunMetricsComputedEventDataSchema,
});
export type SimulationRunMetricsComputedEvent = z.infer<typeof SimulationRunMetricsComputedEventSchema>;

/**
 * CancelRequested event - emitted when a user requests cancellation of a run.
 * Sets CancellationRequestedAt in the fold projection without changing Status.
 * A reactor broadcasts this to all worker pods via Redis pub/sub.
 */
export const simulationRunCancelRequestedEventDataSchema = z.object({
  scenarioRunId: z.string(),
});
export type SimulationRunCancelRequestedEventData = z.infer<typeof simulationRunCancelRequestedEventDataSchema>;

export const SimulationRunCancelRequestedEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.CANCEL_REQUESTED),
  data: simulationRunCancelRequestedEventDataSchema,
});
export type SimulationRunCancelRequestedEvent = z.infer<typeof SimulationRunCancelRequestedEventSchema>;

/**
 * RunDeleted event - emitted when a simulation run is soft-deleted.
 */
export const simulationRunDeletedEventDataSchema = z.object({
  scenarioRunId: z.string(),
});
export type SimulationRunDeletedEventData = z.infer<typeof simulationRunDeletedEventDataSchema>;

export const SimulationRunDeletedEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.DELETED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.DELETED),
  data: simulationRunDeletedEventDataSchema,
});
export type SimulationRunDeletedEvent = z.infer<typeof SimulationRunDeletedEventSchema>;

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
  | SimulationRunDeletedEvent;

export {
  isSimulationRunQueuedEvent,
  isSimulationMessageSnapshotEvent,
  isSimulationTextMessageStartEvent,
  isSimulationTextMessageEndEvent,
  isSimulationRunDeletedEvent,
  isSimulationRunFinishedEvent,
  isSimulationRunStartedEvent,
  isSimulationRunMetricsComputedEvent,
  isSimulationRunCancelRequestedEvent,
} from "./typeGuards";

