import { DomainError } from "../domain-error";

/**
 * Thrown when a Stripe-dependent operation is invoked in self-hosted
 * (non-SaaS) deployments where no billing provider is available.
 */
export class SubscriptionServiceUnavailableError extends DomainError {
  constructor() {
    super(
      "subscription_service_unavailable",
      "Subscription service is not available in self-hosted mode",
      { httpStatus: 501 },
    );
  }
}
