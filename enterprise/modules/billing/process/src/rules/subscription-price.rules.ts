/**
 * Whether a customer's subscriptions price a meter: the one check every priced meter asks.
 * @see dev/docs/adr/201-pii-redaction-model-call-is-metered.md decision 10
 */

import type { BillingSubscription } from "./billing-stripe-shapes.rules.ts";

/** Statuses whose metered items Stripe still invoices; any other subscription bills nothing. */
const INVOICED_STATUSES: ReadonlySet<BillingSubscription["status"]> = new Set([
  "active",
  "past_due",
  "trialing",
]);

/**
 * Whether one of the customer's invoiced subscriptions has a line on the price. Stripe accepts
 * a meter event no line prices and bills it at nothing, so a meter reports only once this holds.
 */
export function carriesPrice({
  subscriptions,
  priceId,
}: {
  subscriptions: readonly BillingSubscription[];
  priceId: string | undefined;
}): boolean {
  if (priceId === void 0) return false;
  return subscriptions.some(
    (subscription) =>
      INVOICED_STATUSES.has(subscription.status) &&
      subscription.items.some((item) => item.priceId === priceId),
  );
}
