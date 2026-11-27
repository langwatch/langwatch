/**
 * The `data_retention_drift` aggregate: one organization's daily check of its stored rows against
 * its current periods, recorded only when a project drifted, and the one command the wake sends.
 * Spec: modules/data-retention/specs/retention-drift-check.feature
 */
import { retentionCategorySchema } from "@langwatch/data-retention-contract";
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

import { storedRetentionStampSchema } from "../rules/retention-drift.rules.ts";

export const RETENTION_DRIFT_PIPELINE_NAME = "data_retention_drift_check" as const;
export const RETENTION_DRIFT_AGGREGATE_TYPE = "data_retention_drift" as const;
export const RETENTION_DRIFT_EVENT_VERSION = "2026-11-22" as const;
export const RETENTION_DRIFT_DETECTED_EVENT_TYPE =
  "lw.data_retention.retention_drift_detected" as const;
export const CHECK_RETENTION_DRIFT_COMMAND_TYPE =
  "lw.data_retention.check_retention_drift" as const;

export const retentionDriftSchema = z
  .object({
    projectId: z.string().min(1),
    category: retentionCategorySchema,
    /** The period the project resolves to now; 0 keeps forever. */
    expectedDays: z.number().int().nonnegative(),
    /** The other stamps found in the sampled windows, with their sampled row counts. */
    found: z.array(storedRetentionStampSchema).min(1),
  })
  .strict();
export type RetentionDrift = z.infer<typeof retentionDriftSchema>;

export const retentionDriftDetectedEventDataSchema = z
  .object({
    organizationId: z.string().min(1),
    drifted: z.array(retentionDriftSchema).min(1),
    checkedAt: z.number().int().nonnegative(),
  })
  .strict();
export type RetentionDriftDetectedEventData = z.infer<typeof retentionDriftDetectedEventDataSchema>;

export const retentionDriftDetectedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(RETENTION_DRIFT_DETECTED_EVENT_TYPE),
  version: z.literal(RETENTION_DRIFT_EVENT_VERSION),
  data: retentionDriftDetectedEventDataSchema,
});
export type RetentionDriftDetectedEvent = z.infer<typeof retentionDriftDetectedEventSchema>;

/** Check one organization's stored rows; `occurredAt` is the wake the check belongs to. */
export const checkRetentionDriftCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export type CheckRetentionDriftCommandData = z.infer<typeof checkRetentionDriftCommandDataSchema>;
