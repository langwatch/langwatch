/**
 * The PII redaction meter: the month's price in dollars to four places, checkpointed in the
 * Instant Evals meter's units (ADR-201 decision 9).
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 */

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
