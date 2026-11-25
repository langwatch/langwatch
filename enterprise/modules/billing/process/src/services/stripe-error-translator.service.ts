import { BillingProviderUnavailableError } from "@langwatch/enterprise-billing-contract";
import Stripe from "stripe";

export abstract class StripeErrorTranslator {
  abstract translate(error: unknown): unknown;
}

/**
 * Classify provider failures: only rate-limit and unreachable are nameable.
 * Everything else passes through untouched to degrade as "unknown" with trace.
 */
export class StripeErrorTranslatorService extends StripeErrorTranslator {
  private constructor() {
    super();
  }

  static create(): StripeErrorTranslatorService {
    return new StripeErrorTranslatorService();
  }

  translate(error: unknown): unknown {
    if (
      error instanceof Stripe.errors.StripeRateLimitError ||
      error instanceof Stripe.errors.StripeConnectionError
    ) {
      return new BillingProviderUnavailableError({ reasons: [error] });
    }
    return error;
  }
}
