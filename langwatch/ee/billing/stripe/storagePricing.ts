/**
 * Storage pricing (ADR-039 Decision 1, kept unchanged): €3 per GiB-month in
 * binary units on a 30-day-month convention, billed as GiB-hours through the
 * additive hourly meter. The invoice line is Stripe's sum over the period's
 * hourly megabyte values times the per-MiB-hour unit price.
 */
export const EUR_PER_GIB_MONTH = 3;

export const HOURS_PER_BILLING_MONTH = 30 * 24;

export const MIB_PER_GIB = 1024;

/** €3 / 30 / 24 / 1024 ≈ €0.00000407 per MiB-hour. */
export const EUR_PER_MIB_HOUR =
  EUR_PER_GIB_MONTH / (HOURS_PER_BILLING_MONTH * MIB_PER_GIB);

/**
 * The invoice amount for a period's summed meter values (Σ hourly MiB).
 * Mirrors the Stripe sum-meter price so tests can pin the € math end-to-end.
 */
export function euroForMeteredMegabyteHours(sumMegabyteHours: number): number {
  return sumMegabyteHours * EUR_PER_MIB_HOUR;
}
