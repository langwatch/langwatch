import { moduleApi } from "@langwatch/module";
import type { RequestBoundKey } from "@langwatch/plans";

import type {
  GetUsageInput,
  ListOrganizationSpendInput,
  ProjectSpendRollup,
  SendUsageLimitWarningInput,
  UsageLimitWarning,
} from "./entitlement.schemas.ts";
import type { PlanNextStep } from "./plan-next-step.ts";
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
  /** Throws `ERR_PLAN_LIMIT` (402) once the organization spent its monthly allowance. */
  assertWithinUsageLimit(input: { organizationId: string }): Promise<void>;
  sendUsageLimitWarning(input: SendUsageLimitWarningInput): Promise<UsageLimitWarning>;
  listOrganizationSpend(input: ListOrganizationSpendInput): Promise<ProjectSpendRollup[]>;
  /**
   * The ceiling one request dimension answers under the organization's active plan (enterprise
   * for ENTERPRISE/OPEN_SOURCE, free for FREE/LAUNCH, paid otherwise). Precedence: this
   * organization's `LANGWATCH_REQUEST_BOUNDS_BY_ORGANIZATION`, `LANGWATCH_REQUEST_BOUNDS`, tier.
   */
  requestBound(input: { key: RequestBoundKey; organizationId: string }): Promise<number>;
  /** Where this plan upgrades next, priced from the organization's own model and currency. */
  resolvePlanNextStep(
    input: Readonly<{ plan: Plan; organizationId: string }>,
  ): Promise<PlanNextStep>;
}

export const EntitlementApi = moduleApi<EntitlementApi>()("entitlement");
