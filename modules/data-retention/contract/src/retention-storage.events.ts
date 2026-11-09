import type { Named } from "@langwatch/module";
import { z } from "zod";

/**
 * The daily retention storage report's aggregate and its one fact: what an organization kept
 * past the included 90 days on one UTC day. Billing reads the fact; none asks for it (§9).
 * Spec: specs/billing/retention-storage-billing.feature
 */
export const RETENTION_STORAGE_PIPELINE_NAME = "data_retention_storage_report" as const;
export const RETENTION_STORAGE_AGGREGATE_TYPE = "data_retention_storage" as const;
export const RETENTION_STORAGE_EVENT_VERSION = "2026-11-09" as const;
export const RETENTION_STORAGE_MEASURED_EVENT_TYPE =
  "lw.data_retention.retention_storage_measured" as const;
export const REPORT_RETENTION_STORAGE_COMMAND_TYPE =
  "lw.data_retention.report_retention_storage" as const;

/** A UTC calendar day, `YYYY-MM-DD`: the day one measurement covers. */
export const retentionStorageDaySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/);

const retentionStorageMeasuredEventDataSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    day: retentionStorageDaySchema,
    /** The longest retention any of the organization's rules keeps; 0 keeps forever. */
    longestRetentionDays: z.number().int().nonnegative(),
    bytesAboveIncluded: z.number().finite().nonnegative(),
    gbBeyondIncluded: z.number().finite().nonnegative(),
    /** The day's share of a GB-month: the GB over the days in its UTC month. */
    dailyShareGb: z.number().finite().nonnegative(),
    /** The meter identifier, `retention-storage:<organization>:<day>`; one per day. */
    identifier: z.string().min(1),
    measuredAt: z.number().int().nonnegative(),
  })
  .strict();
export interface RetentionStorageMeasuredEventDataSchema extends Named<
  typeof retentionStorageMeasuredEventDataSchemaDefinition
> {}
export const retentionStorageMeasuredEventDataSchema: RetentionStorageMeasuredEventDataSchema =
  retentionStorageMeasuredEventDataSchemaDefinition;
export type RetentionStorageMeasuredEventData = z.infer<
  typeof retentionStorageMeasuredEventDataSchema
>;
