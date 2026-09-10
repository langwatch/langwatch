import { defineModule } from "@langwatch/runtime-composition";
import { ServerOrganizationApp } from "./app/organization.app.ts";
import { organizationRepositories } from "./repositories/organization-repositories.registry.ts";
import { groupTrpcTransport } from "./transport/group.trpc.ts";
import { joinRequestTrpcTransport } from "./transport/join-request.trpc.ts";
import { onboardingTrpcTransport } from "./transport/onboarding.trpc.ts";
import { organizationManagementRest } from "./transport/organization-management.rest.ts";
import { organizationTrpcTransport } from "./transport/organization.trpc.ts";
import { organizationsProvisioningRest } from "./transport/organizations.rest.ts";
import { personalWorkspaceFeaturesTrpcTransport } from "./transport/personal-workspace-features.trpc.ts";
import { createTeamRest } from "./transport/team.rest.ts";
import { teamTrpcTransport } from "./transport/team.trpc.ts";

export const organizationServer = defineModule("organization")
  .withRepositories(organizationRepositories)
  .withApp(ServerOrganizationApp)
  .withTransports(
    organizationTrpcTransport,
    teamTrpcTransport,
    groupTrpcTransport,
    joinRequestTrpcTransport,
    onboardingTrpcTransport,
    personalWorkspaceFeaturesTrpcTransport,
    organizationManagementRest,
    organizationsProvisioningRest,
  )
  .build();
