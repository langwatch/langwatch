import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { defineProcessModule } from "@langwatch/process";

import { EntitlementModule } from "./app/entitlement.app.ts";
import { entitlementUsageWarningEventing } from "./eventing/entitlement-usage-warning.pipeline.ts";
import { entitlementRepositories } from "./repositories/entitlement-repositories.registry.ts";
import { absentRequestBound } from "./rules/plan-baseline.rules.ts";
import { organizationSpendTrpcTransport } from "./transport/organization-spend.trpc.ts";
import { planTrpcTransport } from "./transport/plan.trpc.ts";
import { usageLimitsTrpcTransport } from "./transport/usage-limits.trpc.ts";

export const entitlementProcessModule = defineProcessModule("entitlement")
  .withRepositories(entitlementRepositories)
  .withApi(EntitlementModule)
  .withTransports(planTrpcTransport, usageLimitsTrpcTransport, organizationSpendTrpcTransport)
  .withEventing(entitlementUsageWarningEventing);

/**
 * The request-bound seam for a process that composes no entitlement graph at
 * all: every bound answers its free-tier value.
 */
export function createAbsentRequestBound(): Pick<EntitlementApi, "requestBound"> {
  return { requestBound: async ({ key }) => absentRequestBound({ key }) };
}
