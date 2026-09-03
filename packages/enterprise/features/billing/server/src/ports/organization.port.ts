/** Narrow organization reads needed by the billing lifecycle services. */
export abstract class BillingOrganizationPort {
  abstract tryGetPricingModel(organizationId: string): Promise<string | null>;
  abstract tryGetStripeCustomerId(organizationId: string): Promise<string | null>;
  abstract tryFindName(
    organizationId: string,
  ): Promise<{ id: string; name: string } | null>;
  abstract tryFindFirstTeamId(organizationId: string): Promise<string | null>;
}
