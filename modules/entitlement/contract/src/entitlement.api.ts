import { featureApi } from "@langwatch/runtime-composition";
import type {
  GetUsageInput,
  ListOrganizationSpendInput,
  ProjectSpendRollup,
  SendUsageLimitWarningInput,
  UsageLimitWarning,
} from "./entitlement.schemas.ts";
import type { Plan } from "./plan.ts";
import type { ResolvePlanInput } from "./provider.ts";
import type { UsageStats } from "./usage.ts";

/**
 * What a plan allows, and what has been used and spent against it. One
 * capability, because the allowance a banner quotes and the reading a usage
 * panel shows have to be the same answer.
 */
export interface EntitlementApi {
  getActivePlan(input: ResolvePlanInput): Promise<Plan>;
  getUsage(input: GetUsageInput): Promise<UsageStats>;
  sendUsageLimitWarning(input: SendUsageLimitWarningInput): Promise<UsageLimitWarning>;
  listOrganizationSpend(input: ListOrganizationSpendInput): Promise<ProjectSpendRollup[]>;
}

export const EntitlementApi = featureApi<EntitlementApi>("entitlement");
