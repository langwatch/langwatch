/**
 * Every `dataRetention.*` procedure, declared once: the settings page reads
 * these same schemas as its client's types, and the server binds a permission
 * and a handler to the names stated here.
 */

import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import {
  retentionPolicySnapshotSchema,
  retentionStorageUsageSchema,
} from "./data-retention.snapshot.ts";
import {
  killRetroactiveMutationInputSchema,
  resolvedRetentionSchema,
  retentionCategorySchema,
  retentionDaysInputSchema,
  retentionPolicySchema,
  retentionScopeSchema,
  retroactiveMutationProgressSchema,
  retroactiveMutationProjectInputSchema,
  retroactiveRetentionUpdateResultSchema,
} from "./data-retention.ts";

/** The project every retention procedure is opened from. */
export const retentionProjectScopeSchema = z.object({ projectId: z.string() });

/** One scope an override is written at, as the door spells it. */
export const retentionScopeInputSchema = z.object({
  scopeType: retentionScopeSchema,
  scopeId: z.string().min(1),
});

export const retentionScopeTargetInputSchema = z.object({
  ...retentionProjectScopeSchema.shape,
  scope: retentionScopeInputSchema,
});

/**
 * A scope write may name the organisation the page sits in, and the target must sit there too;
 * without one the server reads it from the target the door approved (RETENTION-ORG, 2026-10-09).
 */
export const retentionScopeWriteInputSchema = z.object({
  ...retentionScopeTargetInputSchema.shape,
  organizationId: z.string().min(1).optional(),
});

export const retentionTriggerRetroactiveInputSchema = z.strictObject({
  ...retroactiveMutationProjectInputSchema.shape,
  category: retentionCategorySchema,
});

export const dataRetentionTrpc = defineTrpcContract("dataRetention")
  /**
   * The retention settings snapshot for a project: effective per-category
   * retention, the readable override rules, and the writable scopes for the
   * chip picker. The snapshot RBAC-filters what it returns.
   */
  .query("getRules")
  .withInput(retentionProjectScopeSchema)
  .withOutput(retentionPolicySnapshotSchema)

  /**
   * Set one category's retention at one scope. The door asks the permission on
   * `scope`; `projectId` is not acted on, and the plan gate reads `organizationId`, or the
   * target's own organisation when none is named.
   */
  .mutation("setForScope")
  .withInput(
    z.object({
      ...retentionScopeWriteInputSchema.shape,
      category: retentionCategorySchema,
      retentionDays: retentionDaysInputSchema,
    }),
  )
  .withOutput(retentionPolicySchema)

  /**
   * What each category would fall back to if the scope's override were removed
   * — the cascade value the data would land on, so the remove-confirmation
   * dialog names the real number rather than a guessed one.
   */
  .query("previewScopeRemoval")
  .withInput(retentionScopeWriteInputSchema)
  .withOutput(resolvedRetentionSchema)

  /** Remove one category's override at one scope; the next tier then applies. */
  .mutation("removeForScope")
  .withInput(
    z.object({ ...retentionScopeWriteInputSchema.shape, category: retentionCategorySchema }),
  )

  /** Rewrite the project's existing rows to the retention the cascade resolves. */
  .mutation("triggerRetroactiveUpdate")
  .withInput(retentionTriggerRetroactiveInputSchema)
  .withOutput(retroactiveRetentionUpdateResultSchema)

  .query("getMutationProgress")
  .withInput(retroactiveMutationProjectInputSchema)
  .withOutput(retroactiveMutationProgressSchema.array())

  .mutation("killMutation")
  .withInput(killRetroactiveMutationInputSchema)

  /**
   * Total stored bytes for the projects the scope selector resolves to, summed
   * across every in-scope project the caller can read, so a wider scope never
   * leaks storage the caller could not have opened.
   */
  .query("getScopeStorageUsage")
  .withInput(retentionScopeTargetInputSchema)
  .withOutput(retentionStorageUsageSchema)
  .build();
