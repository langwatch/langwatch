import { isEnterpriseTier, type EntitlementApi } from "@langwatch/entitlement-contract";

import type {
  DataRetentionPlan,
  DataRetentionPlanResolver,
} from "../app/data-retention.members.ts";

/**
 * The plan behind a retention gate, reduced to the two facts retention tiers on. Which plan
 * types count as enterprise is entitlement's answer; an unknown tier fails closed.
 */
export class RetentionPlanService implements DataRetentionPlanResolver {
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

    return { free: plan.free, uncapped: !this.isSaas || isEnterpriseTier(plan.type) };
  }
}
