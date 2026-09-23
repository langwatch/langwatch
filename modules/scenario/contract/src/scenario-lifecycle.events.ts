import { z } from "zod";

import { simulationEventSchema } from "./simulation.events.ts";

/** The scenario's own lifecycle, apart from its runs. */
export const SCENARIO_LIFECYCLE_PIPELINE_NAME = "scenario_lifecycle" as const;
export const SCENARIO_AGGREGATE_TYPE = "scenario" as const;

export const SCENARIO_CREATED_EVENT_TYPE = "lw.scenario.created" as const;
export const SCENARIO_CREATED_EVENT_VERSION = "2026-09-23" as const;
export const RECORD_SCENARIO_CREATED_COMMAND_TYPE = "lw.scenario.record_created" as const;

export const SCENARIO_LIFECYCLE_EVENT_TYPES = [SCENARIO_CREATED_EVENT_TYPE] as const;

/** A scenario was written, and how many the project holds counting it. */
export const scenarioCreatedEventDataSchema = z.object({
  scenarioId: z.string(),
  projectId: z.string(),
  userId: z.string(),
  scenarioCount: z.number().int().nonnegative(),
});
export type ScenarioCreatedEventData = z.infer<typeof scenarioCreatedEventDataSchema>;

export const scenarioCreatedEventSchema = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SCENARIO_CREATED_EVENT_TYPE),
  version: z.literal(SCENARIO_CREATED_EVENT_VERSION),
  data: scenarioCreatedEventDataSchema,
});
export type ScenarioCreatedEvent = z.infer<typeof scenarioCreatedEventSchema>;
export type ScenarioLifecycleEvent = ScenarioCreatedEvent;
