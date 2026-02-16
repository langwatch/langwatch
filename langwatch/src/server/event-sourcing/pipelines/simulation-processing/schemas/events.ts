import { z } from "zod";
import { EventSchema } from "../../../library/domain/types";
import {
  SIMULATION_RUN_STATUS,
  simulationMessageSchema,
  simulationResultsSchema,
} from "./shared";
import {
  SIMULATION_EVENT_TYPES,
} from "./constants";

/**
 * Simulation run started event data.
 */
export const simulationRunStartedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  metadata: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
  }),
});

export const simulationRunStartedEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_EVENT_TYPES.RUN_STARTED),
  data: simulationRunStartedEventDataSchema,
});

export type SimulationRunStartedEventData = z.infer<
  typeof simulationRunStartedEventDataSchema
>;
export type SimulationRunStartedEvent = z.infer<
  typeof simulationRunStartedEventSchema
>;

/**
 * Simulation message snapshot event data.
 */
export const simulationMessageSnapshotEventDataSchema = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  messages: z.array(simulationMessageSchema),
});

export const simulationMessageSnapshotEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_EVENT_TYPES.MESSAGE_SNAPSHOT),
  data: simulationMessageSnapshotEventDataSchema,
});

export type SimulationMessageSnapshotEventData = z.infer<
  typeof simulationMessageSnapshotEventDataSchema
>;
export type SimulationMessageSnapshotEvent = z.infer<
  typeof simulationMessageSnapshotEventSchema
>;

/**
 * Simulation run finished event data.
 */
export const simulationRunFinishedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  status: z.enum(SIMULATION_RUN_STATUS),
  results: simulationResultsSchema.optional().nullable(),
});

export const simulationRunFinishedEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_EVENT_TYPES.RUN_FINISHED),
  data: simulationRunFinishedEventDataSchema,
});

export type SimulationRunFinishedEventData = z.infer<
  typeof simulationRunFinishedEventDataSchema
>;
export type SimulationRunFinishedEvent = z.infer<
  typeof simulationRunFinishedEventSchema
>;

/**
 * Simulation run deleted event data.
 */
export const simulationRunDeletedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
});

export const simulationRunDeletedEventSchema = EventSchema.extend({
  type: z.literal(SIMULATION_EVENT_TYPES.RUN_DELETED),
  data: simulationRunDeletedEventDataSchema,
});

export type SimulationRunDeletedEventData = z.infer<
  typeof simulationRunDeletedEventDataSchema
>;
export type SimulationRunDeletedEvent = z.infer<
  typeof simulationRunDeletedEventSchema
>;

/**
 * Union of all simulation processing event types.
 */
export type SimulationProcessingEvent =
  | SimulationRunStartedEvent
  | SimulationMessageSnapshotEvent
  | SimulationRunFinishedEvent
  | SimulationRunDeletedEvent;

export {
  isSimulationRunStartedEvent,
  isSimulationMessageSnapshotEvent,
  isSimulationRunFinishedEvent,
  isSimulationRunDeletedEvent,
} from "./typeGuards";
