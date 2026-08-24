import Stripe from "stripe";
import { BillingProviderUnavailableError } from "@langwatch/enterprise-billing-contract";
import { StripeErrorTranslatorPort } from "../ports/stripe-error-translator.port";

/**
 * Classify a payment-provider failure, or leave it alone.
 *
 * Only two shapes are nameable: the provider told us to slow down, or we could
 * not reach it. Both mean the same thing to a customer — nothing happened, wait
 * and try again — which is the "wait" case in the handled-error rule.
 *
 * Everything else is returned untouched, on purpose. A rejected request, a
 * revoked key or a bug on our side has no user-relevant meaning, and dressing
 * it up as a handled error would leak internals and promise the caller an
 * action they do not have. It degrades to "unknown" at the boundary with a
 * trace id attached, which is the system working as designed.
 *
 * Mirrors `translate-query-error.ts` for ClickHouse, including the fall-through.
 */
export class StripeErrorAdapter extends StripeErrorTranslatorPort {
  private constructor() {
    super();
  }

  static create(): StripeErrorAdapter {
    return new StripeErrorAdapter();
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
