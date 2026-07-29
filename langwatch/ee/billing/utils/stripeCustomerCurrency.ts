import { createLogger } from "@langwatch/observability";
import { Currency } from "@prisma/client";
import type Stripe from "stripe";
import { toError } from "../../../src/utils/posthogErrorCapture";

const logger = createLogger("langwatch:billing:stripeCustomerCurrency");

/**
 * What we were able to establish about the currency a checkout must use.
 *
 * The three cases are kept apart on purpose. Collapsing them into "a currency,
 * or else the one the caller asked for" is what the original bug looked like:
 * Stripe fixes a customer's currency once they have an invoice and rejects
 * sessions in any other one, so guessing wrong is not a degraded result, it is
 * a failed checkout — and by the time the session is created the caller has
 * already written a pending subscription and its invites.
 *
 * - `resolved`  — use this currency. Either the customer's fixed one, or the
 *                 requested one when the customer genuinely has none yet.
 * - `unsupported` — the customer is fixed to a currency we sell no prices in.
 * - `unavailable` — we could not ask. Not evidence that they are unfixed.
 */
export type CheckoutCurrencyResolution =
  | { status: "resolved"; currency: Currency }
  | { status: "unsupported"; stripeCurrency: string }
  | { status: "unavailable"; cause: Error };

/**
 * Establish the currency a checkout session must be created in.
 *
 * Callers must handle `unsupported` and `unavailable` before performing any
 * writes — neither can be turned into a working checkout, so proceeding only
 * trades one failure for the same failure plus orphaned pending records.
 */
export const resolveCheckoutCurrency = async ({
  stripe,
  customerId,
  organizationId,
  requestedCurrency,
}: {
  stripe: Stripe;
  customerId: string;
  organizationId: string;
  requestedCurrency: Currency;
}): Promise<CheckoutCurrencyResolution> => {
  let customer: Stripe.Customer | Stripe.DeletedCustomer;
  try {
    customer = await stripe.customers.retrieve(customerId);
  } catch (error) {
    // Hand the original error back so the caller can attach it as a `reason`
    // on the handled error — that is what carries the provider's own message
    // to the logs, rather than a message copied into a fresh Error here.
    return { status: "unavailable", cause: toError(error) };
  }

  // No currency yet means nothing is fixed, so the requested one is still free
  // to use — this is the path every first-time subscriber takes.
  if (customer.deleted || !customer.currency) {
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

  const currency = fixed as Currency;
  if (currency !== requestedCurrency) {
    logger.warn(
      { organizationId, requestedCurrency, customerCurrency: currency },
      "[billing] Requested checkout currency differs from the customer's billing currency, using the customer's",
    );
  }

  return { status: "resolved", currency };
};
