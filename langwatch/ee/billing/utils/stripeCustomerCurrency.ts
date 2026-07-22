import { Currency } from "@prisma/client";
import type Stripe from "stripe";

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
