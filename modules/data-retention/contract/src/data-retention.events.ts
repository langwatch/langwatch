import type { Named } from "@langwatch/module";
import { z } from "zod";

import { retentionCategorySchema } from "./data-retention.ts";

/** data-retention's facts, which peers follow from their own side (§9, stored-object ADR-002). */
export const DATA_RETENTION_FACTS_PIPELINE_NAME = "data_retention_facts" as const;
/** Keyed by the project whose retention was applied, so one project's facts arrive in order. */
export const DATA_RETENTION_PROJECT_AGGREGATE_TYPE = "data_retention_project" as const;
export const RETENTION_APPLIED_TO_EXISTING_DATA_EVENT_TYPE =
  "lw.data_retention.retention_applied_to_existing_data" as const;
export const RETENTION_APPLIED_TO_EXISTING_DATA_EVENT_VERSION = "2026-11-16" as const;

/**
 * A retroactive update was triggered; `retentionDays` is the applied value, 0 for indefinite.
 * `raise` only lengthened rows, so followers keep any later end they hold; absent means `apply`.
 */
const retentionAppliedToExistingDataEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  category: retentionCategorySchema,
  retentionDays: z.number().int().nonnegative(),
  mode: z.enum(["apply", "raise"]).optional(),
  occurredAt: z.number().int().nonnegative(),
});
export interface RetentionAppliedToExistingDataEventDataSchema extends Named<
  typeof retentionAppliedToExistingDataEventDataSchemaDefinition
> {}
export const retentionAppliedToExistingDataEventDataSchema: RetentionAppliedToExistingDataEventDataSchema =
  retentionAppliedToExistingDataEventDataSchemaDefinition;
export type RetentionAppliedToExistingDataEventData = z.infer<
  typeof retentionAppliedToExistingDataEventDataSchema
>;
