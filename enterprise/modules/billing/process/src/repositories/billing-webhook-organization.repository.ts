/**
 * Organization reads and writes a Stripe webhook needs. Narrow because billing
 * may not reach the organization repository.
 */
export abstract class BillingWebhookOrganizationRepository {
  abstract findByStripeCustomerId(stripeCustomerId: string): Promise<{ id: string } | null>;

  abstract findNameById(organizationId: string): Promise<{ id: string; name: string } | null>;

  abstract updateCurrency(input: { organizationId: string; currency: string }): Promise<void>;

  abstract clearTrialLicense(organizationId: string): Promise<void>;
}
