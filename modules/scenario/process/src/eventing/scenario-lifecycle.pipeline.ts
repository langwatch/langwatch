import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  SCENARIO_AGGREGATE_TYPE,
  SCENARIO_LIFECYCLE_PIPELINE_NAME,
  type ScenarioLifecycleEvent,
  scenarioCreatedEventSchema,
  simulationSetCreatedEventSchema,
} from "@langwatch/scenario-contract";

import type { ScenarioModule } from "../app/scenario.app.ts";
import {
  RecordScenarioCreatedCommand,
  type RecordScenarioCreatedCommandData,
  RecordSimulationSetCreatedCommand,
  type RecordSimulationSetCreatedCommandData,
} from "./scenario-lifecycle.commands.ts";

export type ScenarioLifecyclePipeline = StaticPipelineDefinition<
  ScenarioLifecycleEvent,
  Record<string, Projection>,
  | { name: "recordScenarioCreated"; payload: RecordScenarioCreatedCommandData }
  | { name: "recordSimulationSetCreated"; payload: RecordSimulationSetCreatedCommandData }
>;

/** The api sends the command; peers (nurturing) react to its event from their own side (§9). */
export function buildScenarioLifecyclePipeline(): ScenarioLifecyclePipeline {
  return definePipeline({
    name: SCENARIO_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({
      type: SCENARIO_AGGREGATE_TYPE,
    }),
  })
    .withEvents([scenarioCreatedEventSchema, simulationSetCreatedEventSchema])
    .withCommand("recordScenarioCreated", RecordScenarioCreatedCommand)
    .withCommand("recordSimulationSetCreated", RecordSimulationSetCreatedCommand)
    .build();
}

export const scenarioLifecycleEventing = defineEventingModule({
  pipeline: SCENARIO_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, ScenarioModule>) => app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycleCommands(commands),
});
