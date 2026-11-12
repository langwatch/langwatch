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
import type { UsageMonthBreakdown, UsageStats } from "./usage.ts";

/**
 * What a plan allows, and what has been used and spent against it. One
 * capability, because the allowance a banner quotes and the reading a usage
 * panel shows have to be the same answer.
 */
export interface EntitlementApi {
  getActivePlan(input: ResolvePlanInput): Promise<Plan>;
  getUsage(input: GetUsageInput): Promise<UsageStats>;
  /** This month day by day and project by project, for the usage page. */
  getUsageMonthBreakdown(input: { organizationId: string }): Promise<UsageMonthBreakdown>;
  /** Throws `ERR_PLAN_LIMIT` (402) once the organization spent its monthly allowance. */
  assertWithinUsageLimit(input: { organizationId: string }): Promise<void>;
  /**
   * Throws `LimitExceededError` (`scenarioRuns`) once a capped plan's month of runs is spent.
   * `shouldCountRun: false` only asks. `runKey` is the run start's meter key: a run already
   * admitted or metered under it passes again without being counted twice.
   */
  assertScenarioRunAllowed(input: {
    organizationId: string;
    shouldCountRun?: boolean | undefined;
    runKey?: { projectId: string; deduplicationKey: string } | undefined;
  }): Promise<void>;
  sendUsageLimitWarning(input: SendUsageLimitWarningInput): Promise<UsageLimitWarning>;
  listOrganizationSpend(input: ListOrganizationSpendInput): Promise<ProjectSpendRollup[]>;
  /**
   * The numeric ceiling one request dimension answers under the organization's
   * active plan (enterprise for ENTERPRISE/OPEN_SOURCE, free for FREE/LAUNCH,
   * paid otherwise). `LANGWATCH_REQUEST_BOUNDS` overrides win over tier values.
   */
  requestBound(input: { key: RequestBoundKey; organizationId: string }): Promise<number>;
  /** Where this plan upgrades next, priced from the organization's own model and currency. */
  resolvePlanNextStep(
    input: Readonly<{ plan: Plan; organizationId: string }>,
  ): Promise<PlanNextStep>;
}

export const EntitlementApi = moduleApi<EntitlementApi>()("entitlement");
