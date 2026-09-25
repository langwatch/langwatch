import { moduleApi } from "@langwatch/kernel/module-api";
import type { RequestBoundKey } from "@langwatch/plans";

import type {
  GetUsageInput,
  ListOrganizationSpendInput,
  ProjectSpendRollup,
  SendUsageLimitWarningInput,
  UsageLimitWarning,
} from "./entitlement.schemas.ts";
import type { PlanNextStep } from "./plan-next-step.ts";
import type { Plan, PricingModel } from "./plan.ts";
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
   * The numeric ceiling one request dimension answers under the organization's
   * active plan (enterprise for ENTERPRISE/OPEN_SOURCE, free for FREE/LAUNCH,
   * paid otherwise). `LANGWATCH_REQUEST_BOUNDS` overrides win over tier values.
   */
  requestBound(input: { key: RequestBoundKey; organizationId: string }): Promise<number>;
  /** Where this plan upgrades next, quoted in `currency` (USD when absent). */
  resolvePlanNextStep(
    input: Readonly<{ plan: Plan; pricingModel: PricingModel | null; currency?: "USD" | "EUR" }>,
  ): Promise<PlanNextStep>;
}

export const EntitlementApi = moduleApi<EntitlementApi>()("entitlement");
