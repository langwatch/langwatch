/**
 * Whether a customer's subscriptions carry a usage meter's price, and since when: a meter
 * reports only to a line on its price (ADR-174 decision 18) and bills only from the moment that
 * line was added (ADR-174 decision 26).
 * @see enterprise/modules/billing/specs/usage-billed-from-line-date.feature
 */

import type {
  BillingSubscription,
  BillingSubscriptionItem,
} from "./billing-stripe-shapes.rules.ts";
import { billingMonthWindowMs } from "./instant-eval-meter.rules.ts";

/** No line: nothing is billed. A line: billed from `addedAtMs`, or the month's bounds when null. */
export type PriceLine = { carried: false } | { carried: true; addedAtMs: number | null };

/** One of a meter's prices, by its catalogue name and this mode's id, if the mode maps one. */
type MeterPrice = { priceName: string; priceId: string | undefined };

/** Statuses whose metered items Stripe still invoices; any other subscription bills nothing. */
const INVOICED_STATUSES: ReadonlySet<BillingSubscription["status"]> = new Set([
  "active",
  "past_due",
  "trialing",
]);

/**
 * How long before a new line a cancelled subscription may have ended and still hand its line
 * on: a replacement cancels the old subscription around the new one's checkout, not to the second.
 */
const REPLACEMENT_TOLERANCE_MS = 60_000;

/** A line on the catalogue's price, or on any price carrying its name: a re-price keeps a key. */
function isLineOn({ item, priceName, priceId }: { item: BillingSubscriptionItem } & MeterPrice) {
  return (
    item.priceId === priceId || item.lookupKey === priceName || item.langwatchKey === priceName
  );
}

/** When a line was added; one Stripe answered without a creation time is refused, never guessed. */
function createdMs(item: BillingSubscriptionItem): number {
  if (!Number.isFinite(item.createdAt)) {
    throw new Error(`subscription line ${item.id} has no creation time, so its month is not dated`);
  }

  return item.createdAt * 1000;
}

/** A subscription cancelled within the month: when it ended, and its lines on the price. */
type EndedLines = { endedMs: number; lines: BillingSubscriptionItem[] };

/** Walks back through replacements: a cancelled line hands on its start only with no gap. */
function chainedStartMs({ startMs, ended }: { startMs: number; ended: EndedLines[] }): number {
  const reachable = ended.find(
    ({ endedMs, lines }) =>
      endedMs >= startMs - REPLACEMENT_TOLERANCE_MS && Math.min(...lines.map(createdMs)) < startMs,
  );
  if (!reachable) return startMs;

  return chainedStartMs({
    startMs: Math.min(...reachable.lines.map(createdMs)),
    ended: ended.filter((candidate) => candidate !== reachable),
  });
}

/**
 * Whether an invoiced subscription has a line on any of the prices, and when the line live now
 * was first added: the earliest live line, carried back through a cancelled subscription only
 * when it ended at or after that line began, so usage while no line existed is never billed.
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
  const live = subscriptions.filter(({ status }) => INVOICED_STATUSES.has(status)).flatMap(linesOf);
  if (live.length === 0) return { carried: false };

  const monthStartMs = billingMonthWindowMs(billingMonth).fromMs;
  const ended = subscriptions.flatMap((subscription): EndedLines[] => {
    const { status, endedAt } = subscription;
    const lines = linesOf(subscription);
    const endedMs = typeof endedAt === "number" ? endedAt * 1000 : Number.NaN;
    return status === "canceled" && endedMs > monthStartMs && lines.length > 0
      ? [{ endedMs, lines }]
      : [];
  });

  return {
    carried: true,
    addedAtMs: chainedStartMs({ startMs: Math.min(...live.map(createdMs)), ended }),
  };
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
