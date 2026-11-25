import { isGrowthSeatEventPlan } from "@langwatch/enterprise-billing-contract";
import { isEnterpriseTier, type EntitlementApi } from "@langwatch/entitlement-contract";

/**
 * Organization's retention plan permissions; only the booleans affecting
 * billing/licensing leave this package to avoid coupling to plan readers.
 */
export type DataRetentionPlan = Readonly<{
  /**
   * A free plan gets the platform-wide default and may configure nothing. Every
   * write gate starts here.
   */
  free: boolean;
  /**
   * Whether the plan may persist a whole-week value at or above the enterprise
   * custom floor. An unrecognised tier must resolve to `false` — fails CLOSED
   * to the restrictive menu, the data-loss-safe direction.
   */
  uncapped: boolean;
  /** A Growth seat plan on SaaS: a length above 90 days, or forever, adds storage to its bill. */
  billsStorage: boolean;
}>;

/**
 * The plan behind a retention gate, reduced to the facts retention tiers on. Which plan
 * types count as enterprise is entitlement's answer; an unknown tier fails closed.
 */
export class RetentionPlanService {
  static create(options: {
    entitlement: Pick<EntitlementApi, "getActivePlan">;
    isSaas: boolean;
  }): RetentionPlanService {
    return new RetentionPlanService(options.entitlement, options.isSaas);
  }

  private constructor(
    private readonly entitlement: Pick<EntitlementApi, "getActivePlan">,
    private readonly isSaas: boolean,
  ) {}

  async getPlan(input: {
    organizationId: string;
    userId: string | null;
  }): Promise<DataRetentionPlan> {
    const plan = await this.entitlement.getActivePlan({
      organizationId: input.organizationId,
      ...(input.userId ? { user: { id: input.userId } } : {}),
    });

    return {
      free: plan.free,
      uncapped: !this.isSaas || isEnterpriseTier(plan.type),
      billsStorage: this.isSaas && isGrowthSeatEventPlan(plan.type),
    };
  }
}
