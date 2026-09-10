/**
 * Binds the `groups` REST declaration (`@langwatch/organization-server`) to
 * this process's organization door.
 *
 * The family - the routes, the wire schemas, the handlers and the ledger
 * attribution - lives in the module. What lives here is this process's own
 * concern: the Enterprise plan gate every route in the family clears, which
 * reads the organization the credential resolved.
 */
import { EnterprisePlanRequiredError, isEnterpriseTier } from "@langwatch/enterprise-plan-gate";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { bindRestMiddleware, type MountableRestApp } from "@langwatch/api/rest";
import { groupsRest, groupsRestEnterpriseGate } from "@langwatch/organization-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** What this mount needs to bind the family's one process fact. */
export type GroupsRestOptions = Readonly<{
  organizations: () => OrganizationApi;
  plans: () => PlanProvider;
}>;

/** Mounts `/api/groups` behind this process's organization credential. */
export function mountGroupsRest(
  runtime: ApiRestRuntime,
  options: GroupsRestOptions,
): MountableRestApp {
  return runtime.mount(groupsRest.router(), options.organizations, {
    facts: [
      bindRestMiddleware(groupsRestEnterpriseGate, async (context) => {
        const { organizationId } = runtime.organizationCredentialOf(context.req.raw);
        const plan = await options.plans().getActivePlan({ organizationId });

        if (!isEnterpriseTier(plan.type)) throw new EnterprisePlanRequiredError("MANAGEMENT_API");

        return {};
      }),
    ],
  });
}
