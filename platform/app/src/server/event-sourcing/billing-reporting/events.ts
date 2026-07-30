import { z } from "zod";

/** Matches the `billing_report` aggregate type and the `es-billing_report-*`
 *  killswitch/ops naming already established for this pipeline. */
export const BILLING_PIPELINE_NAME = "billing_report";
export const BILLING_PIPELINE_PREFIX = "lw";

/**
 * The command bridge's own event (ADR-105 consequences: "a meter spanning
 * four vocabularies becomes its own pipeline fed by command bridges rather
 * than a projection reaching sideways" — this pipeline cannot see trace,
 * evaluation or any other pipeline's own events, so `recordBillableEvent`
 * normalises whichever source event triggered it into this one shape).
 */
export const billableEventRecordedSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  organizationId: z.string(),
  tenantId: z.string(),
  deduplicationKey: z.string(),
  eventTimestamp: z.number(),
});
export type BillableEventRecorded = z.infer<typeof billableEventRecordedSchema>;

export const billingReportingEvents = {
  billableEventRecorded: billableEventRecordedSchema,
} as const;
