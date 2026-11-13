import type { Named } from "@langwatch/module";
import { onboardingVariantSchema } from "@langwatch/onboarding-contract";
import { z } from "zod";

import { simulationEventSchema } from "./features/simulation/simulation.events.ts";

/** The scenario's own lifecycle, apart from its runs. */
export const SCENARIO_LIFECYCLE_PIPELINE_NAME = "scenario_lifecycle" as const;
export const SCENARIO_AGGREGATE_TYPE = "scenario" as const;

export const SCENARIO_CREATED_EVENT_TYPE = "lw.scenario.created" as const;
export const SCENARIO_CREATED_EVENT_VERSION = "2026-09-23" as const;
export const RECORD_SCENARIO_CREATED_COMMAND_TYPE = "lw.scenario.record_created" as const;

/** A user simulation set (a run's `scenarioSetId`) was first run; platform-owned sets never are. */
export const SIMULATION_SET_CREATED_EVENT_TYPE = "lw.simulation_set.created" as const;
export const SIMULATION_SET_CREATED_EVENT_VERSION = "2026-11-10" as const;
export const RECORD_SIMULATION_SET_CREATED_COMMAND_TYPE =
  "lw.simulation_set.record_created" as const;

export const SCENARIO_LIFECYCLE_EVENT_TYPES = [
  SCENARIO_CREATED_EVENT_TYPE,
  SIMULATION_SET_CREATED_EVENT_TYPE,
] as const;

/** A scenario was written, how many the project holds counting it, and when. */
const scenarioCreatedEventDataSchemaDefinition = z.object({
  scenarioId: z.string(),
  projectId: z.string(),
  userId: z.string(),
  scenarioCount: z.number().int().nonnegative(),
  /** Where the onboarding experiment put the organization; absent before it. */
  onboardingVariant: onboardingVariantSchema.nullish(),
  occurredAt: z.number().int().nonnegative(),
});
export interface ScenarioCreatedEventDataSchema extends Named<
  typeof scenarioCreatedEventDataSchemaDefinition
> {}
export const scenarioCreatedEventDataSchema: ScenarioCreatedEventDataSchema =
  scenarioCreatedEventDataSchemaDefinition;
export type ScenarioCreatedEventData = z.infer<typeof scenarioCreatedEventDataSchema>;

const scenarioCreatedEventSchemaDefinition = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SCENARIO_CREATED_EVENT_TYPE),
  version: z.literal(SCENARIO_CREATED_EVENT_VERSION),
  data: scenarioCreatedEventDataSchema,
});
export interface ScenarioCreatedEventSchema extends Named<
  typeof scenarioCreatedEventSchemaDefinition
> {}
export const scenarioCreatedEventSchema: ScenarioCreatedEventSchema =
  scenarioCreatedEventSchemaDefinition;
export type ScenarioCreatedEvent = z.infer<typeof scenarioCreatedEventSchema>;

/** A project ran a simulation set it never ran before; ids only. */
const simulationSetCreatedEventDataSchemaDefinition = z.object({
  scenarioSetId: z.string().min(1),
  projectId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export interface SimulationSetCreatedEventDataSchema extends Named<
  typeof simulationSetCreatedEventDataSchemaDefinition
> {}
export const simulationSetCreatedEventDataSchema: SimulationSetCreatedEventDataSchema =
  simulationSetCreatedEventDataSchemaDefinition;
export type SimulationSetCreatedEventData = z.infer<typeof simulationSetCreatedEventDataSchema>;

const simulationSetCreatedEventSchemaDefinition = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_SET_CREATED_EVENT_TYPE),
  version: z.literal(SIMULATION_SET_CREATED_EVENT_VERSION),
  data: simulationSetCreatedEventDataSchema,
});
export interface SimulationSetCreatedEventSchema extends Named<
  typeof simulationSetCreatedEventSchemaDefinition
> {}
export const simulationSetCreatedEventSchema: SimulationSetCreatedEventSchema =
  simulationSetCreatedEventSchemaDefinition;
export type SimulationSetCreatedEvent = z.infer<typeof simulationSetCreatedEventSchema>;

export type ScenarioLifecycleEvent = ScenarioCreatedEvent | SimulationSetCreatedEvent;
