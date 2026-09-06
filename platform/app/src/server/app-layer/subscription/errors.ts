import { HandledError } from "@langwatch/handled-error";

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
      // `fault` defaults to "customer", which would log a 501 as routine
      // caller noise. Nothing the customer did caused this and nothing they
      // can do fixes it — the deployment simply has no billing provider.
      { httpStatus: 501, fault: "platform" },
    );
  }
}
