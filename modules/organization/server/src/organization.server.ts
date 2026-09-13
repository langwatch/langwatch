import { bindRestMiddleware, organizationCredentialOfRequest } from "@langwatch/api/rest";
import { EnterprisePlanRequiredError, isEnterpriseTier } from "@langwatch/enterprise-plan-gate";
import { defineServerModule } from "@langwatch/runtime-composition";
import { ServerOrganizationApp } from "./app/organization.app.ts";
import { organizationRepositories } from "./repositories/organization-repositories.registry.ts";
import { groupsRest, groupsRestEnterpriseGate } from "./transport/group.rest.ts";
import { groupTrpcTransport } from "./transport/group.trpc.ts";
import { joinRequestTrpcTransport } from "./transport/join-request.trpc.ts";
import { onboardingTrpcTransport } from "./transport/onboarding.trpc.ts";
import {
  organizationManagementEnterpriseGate,
  organizationManagementRest,
} from "./transport/organization-management.rest.ts";
import { organizationTrpcTransport } from "./transport/organization.trpc.ts";
import { organizationsProvisioningRest } from "./transport/organizations.rest.ts";
import { personalWorkspaceFeaturesTrpcTransport } from "./transport/personal-workspace-features.trpc.ts";
import { teamTrpcTransport } from "./transport/team.trpc.ts";

export const organizationServer = defineServerModule("organization")
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
    groupsRest,
  )
  // Both families sit behind the organization credential and both require the
  // Enterprise plan: groups arrive with SCIM, and the whole management surface
  // is Enterprise-only. One plan lookup, through the SAME `entitlement` peer
  // every seat and allowance check in this module already reads, so the REST
  // gate and the application's own seat guard can never disagree about which
  // plan an organization is on. Same refusal the deleted mounts raised:
  // `EnterprisePlanRequiredError("MANAGEMENT_API")`, fail-closed on any lookup
  // that rejects.
  .withTransportFacts(({ dependencies }) => {
    const requireEnterprise = async (context: { req: { raw: Request } }) => {
      const { organizationId } = organizationCredentialOfRequest(context.req.raw);
      const plan = await dependencies.entitlement.getActivePlan({ organizationId });

      if (!isEnterpriseTier(plan.type)) throw new EnterprisePlanRequiredError("MANAGEMENT_API");

      return {};
    };

    return [
      bindRestMiddleware(groupsRestEnterpriseGate, requireEnterprise),
      bindRestMiddleware(organizationManagementEnterpriseGate, requireEnterprise),
    ];
  });
