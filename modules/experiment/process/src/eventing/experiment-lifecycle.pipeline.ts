import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  EXPERIMENT_LIFECYCLE_AGGREGATE_TYPE,
  EXPERIMENT_LIFECYCLE_PIPELINE_NAME,
} from "@langwatch/experiment-contract";

import type { ExperimentApp } from "../app/experiment.app.ts";
import { RecordExperimentRanCommand } from "./experiment-lifecycle.commands.ts";
import {
  experimentRanEventSchema,
  type ExperimentLifecycleEvent,
  type RecordExperimentRanCommandData,
} from "./experiment-lifecycle.events.ts";

export type ExperimentLifecyclePipeline = StaticPipelineDefinition<
  ExperimentLifecycleEvent,
  Record<string, Projection>,
  { name: "recordExperimentRan"; payload: RecordExperimentRanCommandData }
>;

/** experiment_lifecycle: experiment records its facts; peers react from their own side (§9). */
export function buildExperimentLifecyclePipeline(): ExperimentLifecyclePipeline {
  return definePipeline({
    name: EXPERIMENT_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: EXPERIMENT_LIFECYCLE_AGGREGATE_TYPE }),
  })
    .withEvents([experimentRanEventSchema])
    .withCommand("recordExperimentRan", RecordExperimentRanCommand)
    .build();
}

export const experimentLifecycleEventing = defineEventingModule({
  pipeline: EXPERIMENT_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, ExperimentApp>) => app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycleCommands(commands),
});
