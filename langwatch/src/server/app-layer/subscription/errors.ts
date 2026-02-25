/**
 * Thrown by Null implementations when a Stripe-dependent operation is invoked
 * in self-hosted (non-SaaS) deployments where no billing provider is available.
 */
export class SubscriptionServiceUnavailableError extends Error {
  constructor() {
    super("Subscription service is not available in self-hosted mode");
    this.name = "SubscriptionServiceUnavailableError";
  }
}
