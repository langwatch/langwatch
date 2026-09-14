/** Narrow organization reads needed by the billing lifecycle services. */
export abstract class BillingOrganization {
  abstract findPricingModel(organizationId: string): Promise<string | null>;
  abstract findStripeCustomerId(organizationId: string): Promise<string | null>;
  abstract findName(organizationId: string): Promise<{ id: string; name: string } | null>;
  abstract findFirstTeamId(organizationId: string): Promise<string | null>;
}

/** Answers every organization read as absent where no directory is composed. */
export class NullBillingOrganizationAdapter extends BillingOrganization {
  private constructor() {
    super();
  }

  static create(): NullBillingOrganizationAdapter {
    return new NullBillingOrganizationAdapter();
  }

  async findPricingModel(): Promise<string | null> {
    return null;
  }

  async findStripeCustomerId(): Promise<string | null> {
    return null;
  }

  async findName(): Promise<{ id: string; name: string } | null> {
    return null;
  }

  async findFirstTeamId(): Promise<string | null> {
    return null;
  }
}
