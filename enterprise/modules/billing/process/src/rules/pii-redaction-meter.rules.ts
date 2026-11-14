/**
 * The PII redaction meter: the month's price in dollars to four places, checkpointed in the
 * Instant Evals meter's units (ADR-201 decision 9).
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 */

import type { BillingSubscription } from "./billing-stripe-shapes.rules.ts";

/** Stripe meter event name for PII redaction, in dollars to four places. */
export const PII_REDACTION_USD_EVENT_NAME = "langwatch_pii_redaction_usd";

/** The deterministic idempotency key for one PII redaction delta, in its own shape. */
export function piiRedactionMeterIdentifier({
  organizationId,
  billingMonth,
  lastReportedTotal,
  targetTotal,
}: {
  organizationId: string;
  billingMonth: string;
  lastReportedTotal: number;
  targetTotal: number;
}): string {
  return `${organizationId}:${billingMonth}:${PII_REDACTION_USD_EVENT_NAME}:from:${lastReportedTotal}:to:${targetTotal}`;
}

/** Statuses whose metered items Stripe still invoices; any other subscription bills nothing. */
const INVOICED_STATUSES: ReadonlySet<BillingSubscription["status"]> = new Set([
  "active",
  "past_due",
  "trialing",
]);

/**
 * Whether one of the customer's invoiced subscriptions has a line on the PII redaction price.
 * Stripe accepts a meter event no line prices and bills it at nothing, so the meter reports
 * only once this holds (ADR-201 decision 10).
 */
export function carriesPiiRedactionPrice({
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
