/**
 * The `data_retention_extension` aggregate: an organization's retention lengthened at a paid
 * activation, and each project's stored rows raised to it, one fact per project and category.
 * Spec: specs/billing/seat-subscription-retention-policy.feature
 */
import { retentionCategorySchema } from "@langwatch/data-retention-contract";
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const RETENTION_EXTENSION_PIPELINE_NAME = "data_retention_extension" as const;
export const RETENTION_EXTENSION_AGGREGATE_TYPE = "data_retention_extension" as const;
export const RETENTION_EXTENSION_EVENT_VERSION = "2026-11-10" as const;
export const RETENTION_EXTENDED_EVENT_TYPE = "lw.data_retention.retention_extended" as const;
export const RETENTION_APPLIED_EVENT_TYPE = "lw.data_retention.retention_applied" as const;
export const RECORD_RETENTION_EXTENSION_COMMAND_TYPE =
  "lw.data_retention.record_retention_extension" as const;
export const APPLY_RETENTION_EXTENSION_COMMAND_TYPE =
  "lw.data_retention.apply_retention_extension" as const;

const categoryRetentionSchema = z
  .object({ category: retentionCategorySchema, retentionDays: z.number().int().nonnegative() })
  .strict();

export const retentionExtendedEventDataSchema = z
  .object({
    organizationId: z.string().min(1),
    /** The activation fact's identity: one extension per activation, however often delivered. */
    extensionId: z.string().min(1),
    /** Each category's organization retention after the activation; 0 keeps forever. */
    retention: z.array(categoryRetentionSchema).min(1),
    extendedAt: z.number().int().nonnegative(),
  })
  .strict();
export type RetentionExtendedEventData = z.infer<typeof retentionExtendedEventDataSchema>;

export const retentionAppliedEventDataSchema = z
  .object({
    organizationId: z.string().min(1),
    projectId: z.string().min(1),
    extensionId: z.string().min(1),
    category: retentionCategorySchema,
    /** The project's resolved retention its stored rows were raised to. */
    retentionDays: z.number().int().nonnegative(),
    tables: z.array(z.string()),
    appliedAt: z.number().int().nonnegative(),
  })
  .strict();
export type RetentionAppliedEventData = z.infer<typeof retentionAppliedEventDataSchema>;

export const retentionExtendedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(RETENTION_EXTENDED_EVENT_TYPE),
  version: z.literal(RETENTION_EXTENSION_EVENT_VERSION),
  data: retentionExtendedEventDataSchema,
});
export const retentionAppliedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(RETENTION_APPLIED_EVENT_TYPE),
  version: z.literal(RETENTION_EXTENSION_EVENT_VERSION),
  data: retentionAppliedEventDataSchema,
});
export type RetentionExtendedEvent = z.infer<typeof retentionExtendedEventSchema>;
export type RetentionAppliedEvent = z.infer<typeof retentionAppliedEventSchema>;
export type RetentionExtensionEvent = RetentionExtendedEvent | RetentionAppliedEvent;

export const recordRetentionExtensionCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  ...retentionExtendedEventDataSchema.shape,
});
export type RecordRetentionExtensionCommandData = z.infer<
  typeof recordRetentionExtensionCommandDataSchema
>;

/** Raise one project's stored rows in one category; `tenantId` is the project. */
export const applyRetentionExtensionCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  extensionId: z.string().min(1),
  category: retentionCategorySchema,
  occurredAt: z.number().int().nonnegative(),
});
export type ApplyRetentionExtensionCommandData = z.infer<
  typeof applyRetentionExtensionCommandDataSchema
>;
