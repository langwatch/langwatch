import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { ServerOrganizationApp } from "../app/organization.app.ts";
import type { OrganizationRepositories } from "../repositories/organization.repositories.ts";
import {
  RecordIntegrationMethodChosenCommand,
  RecordInviteAcceptedCommand,
  RecordMembersInvitedCommand,
  RecordPersonalWorkspaceProvisionedCommand,
  RecordSignedUpCommand,
} from "./organization-lifecycle.commands.ts";
import {
  integrationMethodChosenEventSchema,
  inviteAcceptedEventSchema,
  membersInvitedEventSchema,
  ORGANIZATION_AGGREGATE_TYPE,
  ORGANIZATION_LIFECYCLE_PIPELINE_NAME,
  organizationSignedUpEventSchema,
  personalWorkspaceProvisionedEventSchema,
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
      personalWorkspaceProvisionedEventSchema,
    ])
    .withCommand("recordSignedUp", RecordSignedUpCommand)
    .withCommand("recordMembersInvited", RecordMembersInvitedCommand)
    .withCommand("recordInviteAccepted", RecordInviteAcceptedCommand)
    .withCommand("recordIntegrationMethodChosen", RecordIntegrationMethodChosenCommand)
    .withCommand("recordPersonalWorkspaceProvisioned", RecordPersonalWorkspaceProvisionedCommand);
}

export type OrganizationLifecycleDefinition = ReturnType<
  ReturnType<typeof lifecycleCommands>["build"]
>;

/** organization_lifecycle records; peers (nurturing, governance) react from their own side (§9). */
export function buildOrganizationLifecyclePipeline(): OrganizationLifecycleDefinition {
  return lifecycleCommands().build();
}

export const organizationLifecycleEventing = defineEventingModule({
  pipeline: ORGANIZATION_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<OrganizationRepositories, ServerOrganizationApp>) =>
    app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycle(commands),
});
