import { z } from "zod";

/**
 * Command type constants for the billing-reporting pipeline.
 *
 * The string is the wire identity of every job and every event_log row the
 * monthly roll-up has ever written. It is pinned, never derived.
 */
export const BILLING_REPORT_COMMAND_TYPES = {
  REPORT_USAGE_FOR_MONTH: "lw.billing_report.report_usage_for_month",
} as const;

export const BILLING_REPORTING_COMMAND_TYPES = [
  BILLING_REPORT_COMMAND_TYPES.REPORT_USAGE_FOR_MONTH,
] as const;

export type BillingReportingCommandType = (typeof BILLING_REPORTING_COMMAND_TYPES)[number];

/** The Eventing pipeline this feature registers. */
export const BILLING_REPORTING_PIPELINE_NAME = "billing_reporting" as const;

/**
 * Command data for reporting usage for a billing month.
 * Dispatched by the billingMeterDispatch subscriber after the
 * orgBillableEventsMeter map projection succeeds.
 *
 * Uses organizationId as tenantId — the framework only uses tenantId
 * for groupKey construction (${tenantId}:${aggregateType}:${aggregateId}).
 */
export const reportUsageForMonthCommandDataSchema = z.object({
  organizationId: z.string(),
  billingMonth: z.string(),
  tenantId: z.string(),
  occurredAt: z.number(),
});

export type ReportUsageForMonthCommandData = z.infer<typeof reportUsageForMonthCommandDataSchema>;
