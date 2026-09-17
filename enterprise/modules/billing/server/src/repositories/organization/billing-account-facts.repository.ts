import { BillingAccountFactsRepository } from "../billing-account-facts.repository.ts";

/** Answers every organization read as absent where no directory is composed. */
export class NullBillingOrganizationAdapter extends BillingAccountFactsRepository {
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
