/**
 * One Stripe client per process. Here, not at root, so API version pins where
 * it matters to the services that read the shapes.
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
