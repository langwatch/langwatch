export type BillingOrganization = {
  id: string;
  name: string;
  stripeCustomerId: string | null;
};

export abstract class BillingOrganizationRepository {
  abstract findById(
    organizationId: string,
  ): Promise<BillingOrganization | null>;
  abstract claimStripeCustomerId(input: {
    organizationId: string;
    stripeCustomerId: string;
  }): Promise<boolean>;
  abstract requireById(organizationId: string): Promise<BillingOrganization>;
}
