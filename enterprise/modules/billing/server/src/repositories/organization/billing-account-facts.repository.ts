/** Narrow organization reads needed by the billing lifecycle services. */
export abstract class BillingOrganization {
  abstract tryGetPricingModel(organizationId: string): Promise<string | null>;
  abstract tryGetStripeCustomerId(organizationId: string): Promise<string | null>;
  abstract tryFindName(organizationId: string): Promise<{ id: string; name: string } | null>;
  abstract tryFindFirstTeamId(organizationId: string): Promise<string | null>;
}

/** Answers every organization read as absent where no directory is composed. */
export class NullBillingOrganizationAdapter extends BillingOrganization {
  private constructor() {
    super();
  }

  static create(): NullBillingOrganizationAdapter {
    return new NullBillingOrganizationAdapter();
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
