import { z } from "zod";

/**
 * Command data for reporting usage for a billing month.
 * Dispatched by the billingMeterDispatch reactor after the
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

export type ReportUsageForMonthCommandData = z.infer<
  typeof reportUsageForMonthCommandDataSchema
>;
