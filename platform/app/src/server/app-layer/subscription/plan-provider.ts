import { applyPlanTypeEntitlements } from "../../../../ee/licensing/planEntitlements";
import type {
  PlanInfo,
  PlanProvider,
  PlanProviderUser,
} from "@langwatch/entitlements-contract";

export type { PlanProvider, PlanProviderUser } from "@langwatch/entitlements-contract";
export type PlanResolver = (organizationId: string) => Promise<PlanInfo>;

/**
 * The single point every resolved plan passes through, whichever leg produced
 * it (a signed license, a subscription row, or the unlicensed baseline) and
 * whichever deployment mode is wired underneath (the SaaS composite provider
 * or the self-hosted one).
 *
 * That makes it the one place where a tier's entitlements can be applied once
 * and hold everywhere, so a feature sold with a tier does not have to be
 * written into every contract that predates it.
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
