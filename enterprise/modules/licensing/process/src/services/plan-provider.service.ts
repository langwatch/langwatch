import { applyPlanTypeEntitlements } from "@langwatch/enterprise-licensing-contract";
import type { PlanInfo, PlanProvider, PlanProviderUser } from "@langwatch/entitlement-contract";

export type { PlanProvider, PlanProviderUser } from "@langwatch/entitlement-contract";
export type PlanResolver = (organizationId: string) => Promise<PlanInfo>;

/**
 * The single point where all resolved plans pass through, regardless of source
 * or deployment mode. Applies tier entitlements once for all contracts.
 */
export class PlanProviderService implements PlanProvider {
  private constructor(private readonly provider: PlanProvider) {}

  static create(provider: PlanProvider): PlanProviderService {
    return new PlanProviderService(provider);
  }

  async getActivePlan(params: {
    organizationId: string;
    user?: PlanProviderUser;
  }): Promise<PlanInfo> {
    return applyPlanTypeEntitlements(await this.provider.getActivePlan(params));
  }
}
