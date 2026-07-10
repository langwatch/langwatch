import type { PlanInfo } from "../../../../ee/licensing/planInfo";
import { deriveBillingProfile, deriveCapabilities } from "./billing-profile";

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
  ) {}

  static create(
    provider: PlanProvider,
    { isSaaS }: { isSaaS: boolean },
  ): PlanProviderService {
    return new PlanProviderService(provider, isSaaS);
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
    return {
      ...plan,
      billing: deriveBillingProfile({ plan, isSaaS: this.isSaaS }),
      capabilities: deriveCapabilities({ plan }),
    };
  }
}
