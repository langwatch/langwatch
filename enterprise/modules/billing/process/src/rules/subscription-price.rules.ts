/**
 * Whether a customer's subscriptions price a meter: the one check every priced meter asks.
 * @see dev/docs/adr/174-instant-evals-judge-call-is-metered.md decision 18
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 */

import type {
  BillingSubscription,
  BillingSubscriptionItem,
} from "./billing-stripe-shapes.rules.ts";

/** Statuses whose metered items Stripe still invoices; any other subscription bills nothing. */
const INVOICED_STATUSES: ReadonlySet<BillingSubscription["status"]> = new Set([
  "active",
  "past_due",
  "trialing",
]);

/** A line on the catalogue's price, or on any price carrying its name: a re-price keeps a key. */
function isLineOn({
  item,
  priceName,
  priceId,
}: {
  item: BillingSubscriptionItem;
  priceName: string;
  priceId: string;
}): boolean {
  return (
    item.priceId === priceId || item.lookupKey === priceName || item.langwatchKey === priceName
  );
}

/**
 * Whether one of the customer's invoiced subscriptions has a line on the price. Stripe accepts
 * a meter event no line prices and bills it at nothing, so a meter reports only once this holds.
 * A mode that maps no price for the name never carries it, so its usage is held.
 */
export function carriesPrice({
  subscriptions,
  priceName,
  priceId,
}: {
  subscriptions: readonly BillingSubscription[];
  priceName: string;
  priceId: string | undefined;
}): boolean {
  if (priceId === void 0) return false;
  return subscriptions.some(
    (subscription) =>
      INVOICED_STATUSES.has(subscription.status) &&
      subscription.items.some((item) => isLineOn({ item, priceName, priceId })),
  );
}
