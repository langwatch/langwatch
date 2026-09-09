import { defineModule } from "@langwatch/runtime-composition";
import { ServerOrganizationApp } from "./app/organization.app.ts";
import { groupTrpcTransport } from "./transport/group.trpc.ts";
import { joinRequestTrpcTransport } from "./transport/join-request.trpc.ts";
import { onboardingTrpcTransport } from "./transport/onboarding.trpc.ts";
import { organizationTrpcTransport } from "./transport/organization.trpc.ts";
import { personalWorkspaceFeaturesTrpcTransport } from "./transport/personal-workspace-features.trpc.ts";
import { teamTrpcTransport } from "./transport/team.trpc.ts";

export const organizationServer = defineModule("organization")
  .withApp(ServerOrganizationApp)
  .withTransports(
    organizationTrpcTransport,
    teamTrpcTransport,
    groupTrpcTransport,
    joinRequestTrpcTransport,
    onboardingTrpcTransport,
    personalWorkspaceFeaturesTrpcTransport,
  )
  .build();
