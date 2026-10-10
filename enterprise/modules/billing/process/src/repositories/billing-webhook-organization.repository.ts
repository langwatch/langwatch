/**
 * Organization reads a Stripe webhook needs; its writes are facts organization
 * applies. Narrow because billing may not reach the organization repository.
 */
export abstract class BillingWebhookOrganizationRepository {
  abstract findByStripeCustomerId(stripeCustomerId: string): Promise<{ id: string } | null>;

  abstract findNameById(organizationId: string): Promise<{ id: string; name: string } | null>;
}
