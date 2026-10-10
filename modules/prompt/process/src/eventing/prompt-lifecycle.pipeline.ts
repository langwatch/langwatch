import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  ORGANIZATION_CREATED_EVENT_TYPE,
  organizationCreatedEventDataSchema,
  type OrganizationCreatedEventData,
} from "@langwatch/organization-contract";

import type { PromptModule } from "../app/prompt.app.ts";
import type { PromptRepositories } from "../repositories/prompt.repositories.ts";
import type { PromptService } from "../services/prompt.service.ts";
import {
  RecordPromptCreatedCommand,
  type RecordPromptCreatedCommandData,
  PROMPT_AGGREGATE_TYPE,
  PROMPT_LIFECYCLE_PIPELINE_NAME,
  promptCreatedEventSchema,
  type PromptLifecycleEvent,
} from "./prompt-lifecycle.commands.ts";

export type PromptLifecyclePipeline = StaticPipelineDefinition<
  PromptLifecycleEvent,
  Record<string, Projection>,
  { name: "recordPromptCreated"; payload: RecordPromptCreatedCommandData }
>;

type PromptTagSeed = Pick<PromptService, "seedTagsForOrganization">;

/** Seeds only the tags an organization lacks, so a redelivered fact seeds nothing twice. */
export function seedOrganizationPromptTags({
  tags,
}: {
  tags: PromptTagSeed;
}): (data: OrganizationCreatedEventData) => Promise<void> {
  return ({ organizationId }: OrganizationCreatedEventData) =>
    tags.seedTagsForOrganization({ organizationId });
}

/** The api sends the command; peers (nurturing) react to its event from their own side (§9). */
export function buildPromptLifecyclePipeline({
  tags,
}: {
  tags: PromptTagSeed;
}): PromptLifecyclePipeline {
  return definePipeline({
    name: PROMPT_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: PROMPT_AGGREGATE_TYPE }),
  })
    .withEvents([promptCreatedEventSchema])
    .withCommand("recordPromptCreated", RecordPromptCreatedCommand)
    .withPeerSubscriber("seedOrganizationPromptTags", {
      eventType: ORGANIZATION_CREATED_EVENT_TYPE,
      data: organizationCreatedEventDataSchema,
      handle: seedOrganizationPromptTags({ tags }),
    })
    .build();
}

export const promptLifecycleEventing = defineEventingModule({
  pipeline: PROMPT_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<PromptRepositories, PromptModule>) => app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycleCommands(commands),
});
