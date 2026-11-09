/**
 * The `data_retention_storage` aggregate's event and command: the eventing envelope closed over
 * the contract's fact, and the one command the daily wake and the hand-run task send.
 */
import {
  RETENTION_STORAGE_EVENT_VERSION,
  RETENTION_STORAGE_MEASURED_EVENT_TYPE,
  retentionStorageDaySchema,
  retentionStorageMeasuredEventDataSchema,
} from "@langwatch/data-retention-contract";
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const retentionStorageMeasuredEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(RETENTION_STORAGE_MEASURED_EVENT_TYPE),
  version: z.literal(RETENTION_STORAGE_EVENT_VERSION),
  data: retentionStorageMeasuredEventDataSchema,
});
export type RetentionStorageEvent = z.infer<typeof retentionStorageMeasuredEventSchema>;

/** Measure one organization's storage for one UTC day; `occurredAt` is the measuring instant. */
export const reportRetentionStorageCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  day: retentionStorageDaySchema,
  occurredAt: z.number().int().nonnegative(),
});
export type ReportRetentionStorageCommandData = z.infer<
  typeof reportRetentionStorageCommandDataSchema
>;
