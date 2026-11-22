/**
 * The `data_retention_extension` aggregate: retention lengthened at an activation or a save, or
 * asked to apply to stored data, then each project's stored rows rewritten, one fact per project
 * and category. Specs: modules/data-retention/specs/retention-apply-to-stored-data.feature
 */
import { retentionCategorySchema, retentionScopeSchema } from "@langwatch/data-retention-contract";
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

export const STORED_RETENTION_APPLY_REQUESTED_EVENT_TYPE =
  "lw.data_retention.stored_retention_apply_requested" as const;
export const REQUEST_STORED_RETENTION_APPLY_COMMAND_TYPE =
  "lw.data_retention.request_stored_retention_apply" as const;

const categoryRetentionSchema = z
  .object({ category: retentionCategorySchema, retentionDays: z.number().int().nonnegative() })
  .strict();

/** The scope whose projects a change reaches; an activation reaches the whole organization. */
const reachedScopeSchema = z
  .object({ scopeType: retentionScopeSchema, scopeId: z.string().min(1) })
  .strict();

/** `raise` only lengthens stored rows; `apply` rewrites them to the period, shortening included. */
export const storedRetentionModeSchema = z.enum(["raise", "apply"]);
export type StoredRetentionMode = z.infer<typeof storedRetentionModeSchema>;

export const retentionExtendedEventDataSchema = z
  .object({
    organizationId: z.string().min(1),
    /** The activation or save's identity: one extension each, however often delivered. */
    extensionId: z.string().min(1),
    scope: reachedScopeSchema.optional(),
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
    /** The project's resolved retention its stored rows were raised or rewritten to. */
    retentionDays: z.number().int().nonnegative(),
    mode: storedRetentionModeSchema.default("raise"),
    tables: z.array(z.string()),
    appliedAt: z.number().int().nonnegative(),
  })
  .strict();
export type RetentionAppliedEventData = z.infer<typeof retentionAppliedEventDataSchema>;

/** An admin asked to rewrite the scope's stored rows to the periods its projects resolve to. */
export const storedRetentionApplyRequestedEventDataSchema = z
  .object({
    organizationId: z.string().min(1),
    requestId: z.string().min(1),
    scope: reachedScopeSchema,
    categories: z.array(retentionCategorySchema).min(1),
    requestedAt: z.number().int().nonnegative(),
  })
  .strict();
export type StoredRetentionApplyRequestedEventData = z.infer<
  typeof storedRetentionApplyRequestedEventDataSchema
>;

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
export const storedRetentionApplyRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(STORED_RETENTION_APPLY_REQUESTED_EVENT_TYPE),
  version: z.literal(RETENTION_EXTENSION_EVENT_VERSION),
  data: storedRetentionApplyRequestedEventDataSchema,
});
export type RetentionExtendedEvent = z.infer<typeof retentionExtendedEventSchema>;
export type RetentionAppliedEvent = z.infer<typeof retentionAppliedEventSchema>;
export type StoredRetentionApplyRequestedEvent = z.infer<
  typeof storedRetentionApplyRequestedEventSchema
>;
export type RetentionExtensionEvent =
  | RetentionExtendedEvent
  | RetentionAppliedEvent
  | StoredRetentionApplyRequestedEvent;

export const requestStoredRetentionApplyCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  ...storedRetentionApplyRequestedEventDataSchema.shape,
});
export type RequestStoredRetentionApplyCommandData = z.infer<
  typeof requestStoredRetentionApplyCommandDataSchema
>;

export const recordRetentionExtensionCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  ...retentionExtendedEventDataSchema.shape,
});
export type RecordRetentionExtensionCommandData = z.infer<
  typeof recordRetentionExtensionCommandDataSchema
>;

/** Raise or rewrite one project's stored rows in one category; `tenantId` is the project. */
export const applyRetentionExtensionCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  extensionId: z.string().min(1),
  category: retentionCategorySchema,
  mode: storedRetentionModeSchema.default("raise"),
  occurredAt: z.number().int().nonnegative(),
});
export type ApplyRetentionExtensionCommandData = z.infer<
  typeof applyRetentionExtensionCommandDataSchema
>;
