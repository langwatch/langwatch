import type { PlanInfo } from "../../../../ee/licensing/planInfo";

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
  private constructor(private readonly provider: PlanProvider) {}

  static create(provider: PlanProvider): PlanProviderService {
    return new PlanProviderService(provider);
  }

  async getActivePlan(params: {
    organizationId: string;
    user?: PlanProviderUser;
  }): Promise<PlanInfo> {
    return this.provider.getActivePlan(params);
  }
}
