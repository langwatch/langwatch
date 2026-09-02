/**
 * The four organization reads and writes a Stripe webhook makes.
 *
 * Narrow on purpose: the organization aggregate is a CORE feature's, and the
 * billing package may not reach its repository. What a webhook needs of it is
 * this — which organization a Stripe customer is, what it is called, the
 * currency its invoices settle in, and the trial licence a paid subscription
 * retires.
 */
export abstract class BillingWebhookOrganizationPort {
  abstract findByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<{ id: string } | null>;

  abstract findNameById(
    organizationId: string,
  ): Promise<{ id: string; name: string } | null>;

  abstract updateCurrency(input: {
    organizationId: string;
    currency: string;
  }): Promise<void>;

  abstract clearTrialLicense(organizationId: string): Promise<void>;
}
