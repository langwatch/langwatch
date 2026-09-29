import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { PromptApp } from "../app/prompt.app.ts";
import type { PromptRepositories } from "../repositories/prompt.repositories.ts";
import {
  createPromptCreatedNurturingSubscriber,
  type PromptCreatedNurturingDeps,
} from "./prompt-created-nurturing.subscriber.ts";
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

/** The api sends the command; only the worker constructs the subscriber that announces it. */
export function buildPromptLifecyclePipeline(
  nurturing: PromptCreatedNurturingDeps,
): PromptLifecyclePipeline {
  return definePipeline({
    name: PROMPT_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: PROMPT_AGGREGATE_TYPE }),
  })
    .withEvents([promptCreatedEventSchema])
    .withEventSubscriber(
      "promptCreatedNurturing",
      createPromptCreatedNurturingSubscriber(nurturing),
    )
    .withCommand("recordPromptCreated", RecordPromptCreatedCommand)
    .build();
}

export const promptLifecycleEventing = defineEventingModule({
  pipeline: PROMPT_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<PromptRepositories, PromptApp>) => app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycleCommands(commands),
});
