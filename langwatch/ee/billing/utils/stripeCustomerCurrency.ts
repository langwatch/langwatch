import { createLogger } from "@langwatch/observability";
import { Currency } from "@prisma/client";
import type Stripe from "stripe";

const logger = createLogger("langwatch:billing:stripeCustomerCurrency");

/**
 * Stripe fixes a customer's currency the moment they have any subscription or
 * invoice, and rejects checkout sessions in any other currency. Returns that
 * fixed currency, or null when the customer is deleted, has no currency yet,
 * or is fixed to a currency we don't sell in.
 */
export const getStripeCustomerFixedCurrency = async ({
  stripe,
  customerId,
}: {
  stripe: Stripe;
  customerId: string;
}): Promise<Currency | null> => {
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted || !customer.currency) return null;

  const fixed = customer.currency.toUpperCase();
  return fixed in Currency ? (fixed as Currency) : null;
};

/**
 * Currency the checkout must be built in: the customer's fixed currency when
 * Stripe has one, otherwise whatever the caller asked for. A failed lookup
 * falls back to the requested currency rather than aborting checkout.
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
}): Promise<Currency> => {
  const fixedCurrency = await getStripeCustomerFixedCurrency({
    stripe,
    customerId,
  }).catch((error: unknown) => {
    logger.warn(
      { organizationId, error: (error as Error).message },
      "[billing] Failed to look up Stripe customer currency, using requested currency",
    );
    return null;
  });

  if (fixedCurrency && fixedCurrency !== requestedCurrency) {
    logger.warn(
      { organizationId, requestedCurrency, customerCurrency: fixedCurrency },
      "[billing] Requested checkout currency differs from Stripe customer currency, using customer currency",
    );
  }

  return fixedCurrency ?? requestedCurrency;
};
