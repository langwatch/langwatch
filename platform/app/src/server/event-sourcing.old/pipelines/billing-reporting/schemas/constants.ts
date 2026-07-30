/**
 * Command type constants for the billing-reporting pipeline.
 */

export const BILLING_REPORT_COMMAND_TYPES = {
  REPORT_USAGE_FOR_MONTH: "lw.billing_report.report_usage_for_month",
} as const;

export const BILLING_REPORTING_COMMAND_TYPES = [
  BILLING_REPORT_COMMAND_TYPES.REPORT_USAGE_FOR_MONTH,
] as const;

/**
 * Days into a new month during which the previous month is still reported,
 * so events that arrive late still land on the invoice they belong to.
 *
 * Shared by the two triggers deliberately: the per-event poke and the
 * scheduled sweep must agree on when a month stops being reportable, or the
 * sweep would keep re-reading a month the poke has already abandoned (or the
 * reverse).
 */
export const BILLING_GRACE_PERIOD_DAYS = 3;
