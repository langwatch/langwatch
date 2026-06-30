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

/**
 * Command data for reporting one measured storage hour to Stripe.
 * Dispatched by the storage-reporting dispatcher (Phase 4) once a sealed hour
 * has been measured and persisted to StorageUsageHourly.
 *
 * `sealedHour` is the UTC hour boundary as an ISO-8601 string (the same instant
 * the measurement was anchored to). Like the month command, organizationId is
 * reused as tenantId — the framework only uses tenantId for groupKey
 * construction (${tenantId}:${aggregateType}:${aggregateId}), and storage
 * billing is an org-level concern.
 */
export const reportStorageForHourCommandDataSchema = z.object({
  organizationId: z.string(),
  sealedHour: z.string().datetime(),
  tenantId: z.string(),
  occurredAt: z.number(),
});

export type ReportStorageForHourCommandData = z.infer<
  typeof reportStorageForHourCommandDataSchema
>;
