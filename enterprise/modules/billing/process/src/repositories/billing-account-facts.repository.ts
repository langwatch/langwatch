/** Narrow organization reads needed by the billing lifecycle services. */
export abstract class BillingAccountFactsRepository {
  abstract findPricingModel(organizationId: string): Promise<string | null>;
  abstract findStripeCustomerId(organizationId: string): Promise<string | null>;
  abstract findName(organizationId: string): Promise<{ id: string; name: string } | null>;
  abstract findFirstTeamId(organizationId: string): Promise<string | null>;
}
