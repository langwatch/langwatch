import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { PromptModule } from "../app/prompt.app.ts";
import type { PromptRepositories } from "../repositories/prompt.repositories.ts";
import {
  RecordPromptCreatedCommand,
  type RecordPromptCreatedCommandData,
} from "./prompt-lifecycle.commands.ts";
import {
  PROMPT_AGGREGATE_TYPE,
  PROMPT_LIFECYCLE_PIPELINE_NAME,
  promptCreatedEventSchema,
  type PromptLifecycleEvent,
} from "./prompt-lifecycle.events.ts";

export type PromptLifecyclePipeline = StaticPipelineDefinition<
  PromptLifecycleEvent,
  Record<string, Projection>,
  { name: "recordPromptCreated"; payload: RecordPromptCreatedCommandData }
>;

/** The api sends the command; peers (nurturing) react to its event from their own side (§9). */
export function buildPromptLifecyclePipeline(): PromptLifecyclePipeline {
  return definePipeline({
    name: PROMPT_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: PROMPT_AGGREGATE_TYPE }),
  })
    .withEvents([promptCreatedEventSchema])
    .withCommand("recordPromptCreated", RecordPromptCreatedCommand)
    .build();
}

export const promptLifecycleEventing = defineEventingModule({
  pipeline: PROMPT_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<PromptRepositories, PromptModule>) => app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycleCommands(commands),
});
