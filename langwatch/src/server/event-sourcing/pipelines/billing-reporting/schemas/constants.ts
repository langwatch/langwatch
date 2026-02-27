/**
 * Command type constants for the billing-reporting pipeline.
 */

export const BILLING_REPORT_COMMAND_TYPES = {
  REPORT_USAGE_FOR_MONTH: "lw.billing_report.report_usage_for_month",
} as const;

export const BILLING_REPORTING_COMMAND_TYPES = [
  BILLING_REPORT_COMMAND_TYPES.REPORT_USAGE_FOR_MONTH,
] as const;

export type BillingReportingCommandType =
  (typeof BILLING_REPORTING_COMMAND_TYPES)[number];
