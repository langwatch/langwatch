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
} from "@langwatch/scenario-contract";

import type { ScenarioApp } from "../app/scenario.app.ts";
import {
  createScenarioCreatedNurturingSubscriber,
  type ScenarioCreatedNurturingDeps,
} from "./scenario-created-nurturing.subscriber.ts";
import {
  RecordScenarioCreatedCommand,
  type RecordScenarioCreatedCommandData,
} from "./scenario-lifecycle.commands.ts";

export type ScenarioLifecyclePipeline = StaticPipelineDefinition<
  ScenarioLifecycleEvent,
  Record<string, Projection>,
  { name: "recordScenarioCreated"; payload: RecordScenarioCreatedCommandData }
>;

/** The api sends the command; only the worker constructs the subscriber that announces it. */
export function buildScenarioLifecyclePipeline(
  nurturing: ScenarioCreatedNurturingDeps,
): ScenarioLifecyclePipeline {
  return definePipeline<ScenarioLifecycleEvent>({
    name: SCENARIO_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({
      type: SCENARIO_AGGREGATE_TYPE,
    }),
  })
    .withEvents([scenarioCreatedEventSchema])
    .withEventSubscriber(
      "scenarioCreatedNurturing",
      createScenarioCreatedNurturingSubscriber(nurturing),
    )
    .withCommand("recordScenarioCreated", RecordScenarioCreatedCommand)
    .build();
}

export const scenarioLifecycleEventing = defineEventingModule({
  pipeline: SCENARIO_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, ScenarioApp>) => app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycleCommands(commands),
});
