/**
 * The one Stripe client a process bills through.
 *
 * Here rather than at the composition root so the API version is pinned in the
 * package that knows what it means: a bump changes the shape of every object
 * the webhook and the subscription services read, which is a migration rather
 * than a default. It also keeps the provider SDK off the composition root's own
 * dependency list, where nothing else needs it.
 */
import Stripe from "stripe";

/** The version the retired platform application pinned. */
export const STRIPE_API_VERSION = "2024-04-10";

export class BillingStripeClientService {
  private constructor(private readonly stripe: Stripe) {}

  static create(options: { secretKey: string }): BillingStripeClientService {
    return new BillingStripeClientService(
      new Stripe(options.secretKey, { apiVersion: STRIPE_API_VERSION }),
    );
  }

  /** The client itself, for the services that speak Stripe directly. */
  get client(): Stripe {
    return this.stripe;
  }
}
