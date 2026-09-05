import { createLogger } from "@langwatch/observability";
import type Stripe from "stripe";
import {
  BillingCustomerDeletedError,
  Currency,
  type Currency as CurrencyType,
  UnsupportedBillingCurrencyError,
} from "@langwatch/enterprise-billing-contract";
import type { StripeErrorTranslatorPort } from "../ports/stripe-error-translator.port";

const logger = createLogger("langwatch:billing:stripeCustomerCurrency");

/**
 * What we were able to establish about the currency a checkout must use.
 */
export type CheckoutCurrencyResolution =
  | { status: "resolved"; currency: CurrencyType }
  | { status: "unsupported"; stripeCurrency: string }
  | { status: "deleted" };

/**
 * Establish the currency a checkout session must be created in.
 */
export class StripeCustomerCurrencyService {
  private constructor(private readonly stripeErrors: StripeErrorTranslatorPort) {}

  static create(stripeErrors: StripeErrorTranslatorPort): StripeCustomerCurrencyService {
    return new StripeCustomerCurrencyService(stripeErrors);
  }

  async resolve({
    stripe,
    customerId,
    organizationId,
    requestedCurrency,
  }: {
    stripe: Stripe;
    customerId: string;
    organizationId: string;
    requestedCurrency: CurrencyType;
  }): Promise<CheckoutCurrencyResolution> {
    let customer: Stripe.Customer | Stripe.DeletedCustomer;
    try {
      customer = await stripe.customers.retrieve(customerId);
    } catch (error) {
      // Only rate limiting and an unreachable provider are causes we can name.
      // Anything else we genuinely do not understand, so it is rethrown as-is and
      // degrades to unknown — still before any write, which is what matters here.
      throw this.stripeErrors.translate(error);
    }

    // A deleted customer is not an unfixed one. Stripe keeps returning the
    // record but refuses to attach anything to it, so no currency makes this
    // checkout work — recovering the stored id belongs in its own audited flow.
    if (customer.deleted) {
      logger.warn({ organizationId }, "[billing] Stored billing customer no longer exists");

      return { status: "deleted" };
    }

    // No currency yet means nothing is fixed, so the requested one is still free
    // to use — this is the path every first-time subscriber takes.
    if (!customer.currency) {
      return { status: "resolved", currency: requestedCurrency };
    }

    const fixed = customer.currency.toUpperCase();
    if (!(fixed in Currency)) {
      logger.warn(
        { organizationId, customerCurrency: fixed },
        "[billing] Customer is fixed to a currency with no price catalog",
      );

      return { status: "unsupported", stripeCurrency: fixed };
    }

    const currency = fixed as CurrencyType;
    if (currency !== requestedCurrency) {
      logger.warn(
        { organizationId, requestedCurrency, customerCurrency: currency },
        "[billing] Requested checkout currency differs from the customer's billing currency, using the customer's",
      );
    }

    return { status: "resolved", currency };
  }

  /**
   * The currency to build the checkout in, or the handled error explaining why there isn't
   * one.
   */
  getCurrency(resolution: CheckoutCurrencyResolution): CurrencyType {
    switch (resolution.status) {
      case "resolved":
        return resolution.currency;
      case "unsupported":
        throw new UnsupportedBillingCurrencyError();
      case "deleted":
        throw new BillingCustomerDeletedError();
    }
  }
}
