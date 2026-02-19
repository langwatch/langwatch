import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import { SIMULATION_EVENT_VERSIONS, SIMULATION_RUN_EVENT_TYPES } from "./constants";
import { simulationMessageSchema, simulationResultsSchema } from "./shared";
export type { SimulationRunStatus, SimulationVerdict } from "./shared";

/**
 * RunStarted event - emitted when a simulation run begins.
 */
const simulationRunStartedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
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
const simulationMessageSnapshotEventDataSchema = z.object({
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
const simulationRunFinishedEventDataSchema = z.object({
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
 * RunDeleted event - emitted when a simulation run is soft-deleted.
 */
const simulationRunDeletedEventDataSchema = z.object({
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
  | SimulationRunStartedEvent
  | SimulationMessageSnapshotEvent
  | SimulationRunFinishedEvent
  | SimulationRunDeletedEvent;

export {
  isSimulationMessageSnapshotEvent, isSimulationRunDeletedEvent, isSimulationRunFinishedEvent, isSimulationRunStartedEvent
} from "./typeGuards";

