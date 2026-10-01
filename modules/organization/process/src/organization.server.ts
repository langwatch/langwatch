import { bindRestMiddleware, organizationCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";

import { ServerOrganizationApp } from "./app/organization.app.ts";
import { organizationLifecycleEventing } from "./eventing/organization-lifecycle.pipeline.ts";
import { seatLimitEventing } from "./eventing/seat-limit.pipeline.ts";
import { organizationRepositories } from "./repositories/organization-repositories.registry.ts";
import { groupsRest } from "./transport/group.rest.ts";
import { groupTrpcTransport } from "./transport/group.trpc.ts";
import { inviteTrpcTransport } from "./transport/invite.trpc.ts";
import { joinRequestTrpcTransport } from "./transport/join-request.trpc.ts";
import { licenseEnforcementTrpcTransport } from "./transport/license-enforcement.trpc.ts";
import {
  organizationKeyFacts,
  organizationManagementRest,
} from "./transport/organization-management.rest.ts";
import { organizationTrpcTransport } from "./transport/organization.trpc.ts";
import { organizationsProvisioningRest } from "./transport/organizations.rest.ts";
import { personalWorkspaceFeaturesTrpcTransport } from "./transport/personal-workspace-features.trpc.ts";
import { teamsRest } from "./transport/team.rest.ts";
import { teamTrpcTransport } from "./transport/team.trpc.ts";

export const organizationServer = defineServerModule("organization")
  .withRepositories(organizationRepositories)
  .withApp(ServerOrganizationApp)
  .withTransports(
    organizationTrpcTransport,
    inviteTrpcTransport,
    teamTrpcTransport,
    groupTrpcTransport,
    joinRequestTrpcTransport,
    licenseEnforcementTrpcTransport,
    personalWorkspaceFeaturesTrpcTransport,
    organizationManagementRest,
    organizationsProvisioningRest,
    groupsRest,
    teamsRest,
  )
  .withTransportFacts(() => [
    // Escalation is bounded by the key itself, never by its owner's wider standing.
    bindRestMiddleware(organizationKeyFacts, (context) => ({
      apiKeyId: organizationCredentialOfRequest(context.req.raw).apiKeyId,
    })),
  ])
  .withEventing(seatLimitEventing)
  .withEventing(organizationLifecycleEventing);
