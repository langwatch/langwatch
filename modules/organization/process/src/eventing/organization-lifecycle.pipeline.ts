import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { ServerOrganizationApp } from "../app/organization.app.ts";
import type { OrganizationRepositories } from "../repositories/organization.repositories.ts";
import {
  createOrganizationLifecycleNurturingSubscriber,
  type OrganizationLifecycleNurturingDeps,
} from "./organization-lifecycle-nurturing.subscriber.ts";
import {
  RecordIntegrationMethodChosenCommand,
  RecordInviteAcceptedCommand,
  RecordMembersInvitedCommand,
  RecordSignedUpCommand,
} from "./organization-lifecycle.commands.ts";
import {
  integrationMethodChosenEventSchema,
  inviteAcceptedEventSchema,
  membersInvitedEventSchema,
  ORGANIZATION_AGGREGATE_TYPE,
  ORGANIZATION_LIFECYCLE_PIPELINE_NAME,
  organizationSignedUpEventSchema,
} from "./organization-lifecycle.events.ts";

function lifecycleCommands() {
  return definePipeline({
    name: ORGANIZATION_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: ORGANIZATION_AGGREGATE_TYPE }),
  })
    .withEvents([
      organizationSignedUpEventSchema,
      membersInvitedEventSchema,
      inviteAcceptedEventSchema,
      integrationMethodChosenEventSchema,
    ])
    .withCommand("recordSignedUp", RecordSignedUpCommand)
    .withCommand("recordMembersInvited", RecordMembersInvitedCommand)
    .withCommand("recordInviteAccepted", RecordInviteAcceptedCommand)
    .withCommand("recordIntegrationMethodChosen", RecordIntegrationMethodChosenCommand);
}

export type OrganizationLifecycleDefinition = ReturnType<
  ReturnType<typeof lifecycleCommands>["build"]
>;

/** organization_lifecycle: the api only records; the worker also tells nurturing (§9). */
export function buildOrganizationLifecyclePipeline(input: {
  nurturing?: OrganizationLifecycleNurturingDeps;
}): OrganizationLifecycleDefinition {
  const nurturing = input.nurturing;
  if (!nurturing) return lifecycleCommands().build();
  return lifecycleCommands()
    .withEventSubscriber(
      "organizationLifecycleNurturing",
      createOrganizationLifecycleNurturingSubscriber(nurturing),
    )
    .build();
}

export const organizationLifecycleEventing = defineEventingModule({
  pipeline: ORGANIZATION_LIFECYCLE_PIPELINE_NAME,
  build: ({ app, participation }: EventingSetup<OrganizationRepositories, ServerOrganizationApp>) =>
    app.lifecyclePipeline({ participation }),
  connect: ({ app, commands }) => app.connectLifecycle(commands),
});
