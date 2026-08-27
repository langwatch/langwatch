/** Narrow organization reads needed by the billing lifecycle services. */
export abstract class BillingOrganizationRepository {
  abstract tryGetPricingModel(organizationId: string): Promise<string | null>;
  abstract tryGetStripeCustomerId(organizationId: string): Promise<string | null>;
  abstract tryFindName(
    organizationId: string,
  ): Promise<{ id: string; name: string } | null>;
  abstract tryFindFirstTeamId(organizationId: string): Promise<string | null>;
}

export class NullBillingOrganizationRepository extends BillingOrganizationRepository {
  private constructor() {
    super();
  }

  static create(): NullBillingOrganizationRepository {
    return new NullBillingOrganizationRepository();
  }

  async tryGetPricingModel(): Promise<string | null> {
    return null;
  }

  async tryGetStripeCustomerId(): Promise<string | null> {
    return null;
  }

  async tryFindName(): Promise<{ id: string; name: string } | null> {
    return null;
  }

  async tryFindFirstTeamId(): Promise<string | null> {
    return null;
  }
}
