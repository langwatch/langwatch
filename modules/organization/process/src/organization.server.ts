import { bindRestMiddleware, organizationCredentialOfRequest } from "@langwatch/api/rest";
import { EnterprisePlanRequiredError, isEnterpriseTier } from "@langwatch/entitlement-contract";
import { defineServerModule } from "@langwatch/kernel";

import { ServerOrganizationApp } from "./app/organization.app.ts";
import { organizationRepositories } from "./repositories/organization-repositories.registry.ts";
import { groupsRest, groupsRestEnterpriseGate } from "./transport/group.rest.ts";
import { groupTrpcTransport } from "./transport/group.trpc.ts";
import { joinRequestTrpcTransport } from "./transport/join-request.trpc.ts";
import {
  organizationManagementEnterpriseGate,
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
    teamTrpcTransport,
    groupTrpcTransport,
    joinRequestTrpcTransport,
    personalWorkspaceFeaturesTrpcTransport,
    organizationManagementRest,
    organizationsProvisioningRest,
    groupsRest,
    teamsRest,
  )
  // Both families sit behind the organization credential and require the
  // Enterprise plan, checked through the SAME `entitlement` peer every seat
  // check in this module reads — so the REST gate and the seat guard can
  // never disagree. Fail-closed: `EnterprisePlanRequiredError("MANAGEMENT_API")`
  // on any lookup that rejects.
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
