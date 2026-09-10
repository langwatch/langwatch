import { BillingOrganization } from "../ports/organization.port.ts";

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
