import { HandledError } from "../handled-error";

/**
 * Thrown when a Stripe-dependent operation is invoked in self-hosted
 * (non-SaaS) deployments where no billing provider is available.
 */
export class SubscriptionServiceUnavailableError extends HandledError {
  declare readonly code: "subscription_service_unavailable";

  constructor() {
    super(
      "subscription_service_unavailable",
      "Subscription service is not available in self-hosted mode",
      { httpStatus: 501 },
    );
  }
}
