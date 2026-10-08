/** Narrow organization reads needed by the billing lifecycle services. */
export abstract class BillingAccountFactsRepository {
  abstract findPricingModel(organizationId: string): Promise<string | null>;
  abstract findStripeCustomerId(organizationId: string): Promise<string | null>;
  abstract findName(organizationId: string): Promise<{ id: string; name: string } | null>;
  abstract findFirstTeamId(organizationId: string): Promise<string | null>;
  /** The name and Stripe customer a checkout bills, or null when the organization is gone. */
  abstract findBillingProfile(
    organizationId: string,
  ): Promise<{ name: string; stripeCustomerId: string | null } | null>;
  /**
   * Claims the Stripe customer id when none is set; false when another checkout won. The one
   * write billing keeps on organization's table (Alex, 2026-10-08, round 46 D-b).
   */
  abstract claimStripeCustomerId(input: {
    organizationId: string;
    stripeCustomerId: string;
  }): Promise<boolean>;
}
