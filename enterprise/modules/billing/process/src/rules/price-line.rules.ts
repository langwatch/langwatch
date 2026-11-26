/**
 * Whether a customer's subscriptions carry a usage meter's price, and since when: a usage meter
 * bills only from the moment its line was added (ADR-174 decision 26).
 * @see enterprise/modules/billing/specs/usage-billed-from-line-date.feature
 */

import type { BillingSubscription } from "./billing-stripe-shapes.rules.ts";
import { billingMonthWindowMs } from "./instant-eval-meter.rules.ts";
import { INVOICED_STATUSES, isLineOn } from "./subscription-price.rules.ts";

/** No line: nothing is billed. A line: billed from `addedAtMs`, or the month's bounds when null. */
export type PriceLine = { carried: false } | { carried: true; addedAtMs: number | null };

/** One of a meter's prices, by its catalogue name and this mode's id, if the mode maps one. */
type MeterPrice = { priceName: string; priceId: string | undefined };

/**
 * Whether an invoiced subscription has a line on any of the prices, and the earliest creation
 * among those lines live in the month (a cancelled one counts if it ended after the month began),
 * so a replacement never moves it later. A line with no creation time reads as no start.
 */
export function priceLineOf({
  subscriptions,
  prices,
  billingMonth,
}: {
  subscriptions: readonly BillingSubscription[];
  prices: readonly MeterPrice[];
  billingMonth: string;
}): PriceLine {
  const mapped = prices.flatMap(({ priceName, priceId }) =>
    priceId === void 0 ? [] : [{ priceName, priceId }],
  );
  const linesOf = (subscription: BillingSubscription) =>
    subscription.items.filter((item) => mapped.some((price) => isLineOn({ item, ...price })));
  const invoiced = subscriptions.filter(({ status }) => INVOICED_STATUSES.has(status));
  if (!invoiced.some((subscription) => linesOf(subscription).length > 0)) return { carried: false };

  const monthStartMs = billingMonthWindowMs(billingMonth).fromMs;
  const endedInMonth = subscriptions.filter(
    ({ status, endedAt }) =>
      status === "canceled" && typeof endedAt === "number" && endedAt * 1000 > monthStartMs,
  );
  const lines = [...invoiced, ...endedInMonth].flatMap(linesOf);
  const created = lines.flatMap(({ createdAt }) =>
    typeof createdAt === "number" ? [createdAt] : [],
  );
  if (created.length < lines.length) return { carried: true, addedAtMs: null };

  return { carried: true, addedAtMs: Math.min(...created) * 1000 };
}

/** The later of the seat start and the line creation; the whole month when neither is known. */
export function meterBilledSince({
  usageBilledSinceMs,
  lineAddedAtMs,
}: {
  usageBilledSinceMs: number | null;
  lineAddedAtMs: number | null;
}): { outcome: "whole_month" } | { outcome: "since"; startMs: number } {
  const starts = [usageBilledSinceMs, lineAddedAtMs].flatMap((at) => (at === null ? [] : [at]));

  return starts.length > 0
    ? { outcome: "since", startMs: Math.max(...starts) }
    : { outcome: "whole_month" };
}
