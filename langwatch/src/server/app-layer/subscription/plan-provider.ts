import type { PlanInfo } from "../../../../ee/licensing/planInfo";
import { deriveBillingProfile, deriveCapabilities } from "./billing-profile";
import type { PricingModelSelfHeal } from "./pricing-model-heal";

export type PlanResolver = (organizationId: string) => Promise<PlanInfo>;

export type PlanProviderUser = {
  id?: string;
  email?: string | null;
  name?: string | null;
  impersonator?: { email?: string | null };
};

export interface PlanProvider {
  getActivePlan(params: {
    organizationId: string;
    user?: PlanProviderUser;
  }): Promise<PlanInfo>;
}

export class PlanProviderService implements PlanProvider {
  private constructor(
    private readonly provider: PlanProvider,
    private readonly isSaaS: boolean,
    private readonly selfHeal?: PricingModelSelfHeal,
  ) {}

  static create(
    provider: PlanProvider,
    { isSaaS, selfHeal }: { isSaaS: boolean; selfHeal?: PricingModelSelfHeal },
  ): PlanProviderService {
    return new PlanProviderService(provider, isSaaS, selfHeal);
  }

  /**
   * Resolves the winning plan and stamps its derived billing profile and
   * capabilities (ADR-039). This wrapper is the single derivation point —
   * both the SaaS composite provider and the self-hosted license provider
   * flow through it, so no consumer ever re-derives billing mechanics from
   * raw stored signals.
   */
  async getActivePlan(params: {
    organizationId: string;
    user?: PlanProviderUser;
  }): Promise<PlanInfo> {
    const plan = await this.provider.getActivePlan(params);

    // Lazy pricingModel convergence + license/subscription conflict detection
    // (ADR-039 Decisions 3 & 11). Fire-and-forget: the heal guards, logs, and
    // swallows internally — never blocks or fails plan resolution.
    void this.selfHeal?.({ organizationId: params.organizationId, plan });

    return {
      ...plan,
      billing: deriveBillingProfile({ plan, isSaaS: this.isSaaS }),
      capabilities: deriveCapabilities({ plan }),
    };
  }
}
