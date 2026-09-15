/**
 * What the retention settings page reads. Schemas rather than bare types
 * because `data-retention.trpc.ts` states two answers with them, and the
 * browser reads that declaration as its client's types.
 */

import { z } from "zod";
import {
  resolvedRetentionSchema,
  retentionCategorySchema,
  retentionScopeSchema,
} from "./data-retention.ts";

/** One scope a retention rule can be bound to, named for a reader. */
export const retentionScopeRefSchema = z.object({
  scopeType: retentionScopeSchema,
  scopeId: z.string(),
  name: z.string(),
});
export type RetentionScopeRef = z.infer<typeof retentionScopeRefSchema>;

/** One stored override: a scope, a category, and the days it keeps. */
export const retentionRuleSchema = z.object({
  ...retentionScopeRefSchema.shape,
  category: retentionCategorySchema,
  retentionDays: z.number(),
});
export type RetentionRule = z.infer<typeof retentionRuleSchema>;

/**
 * The scopes the caller may write an override at, RBAC-filtered by the server.
 * A caller who may write nowhere gets every list empty, which is what the page
 * reads to decide whether to offer the add and edit controls at all.
 */
export const retentionScopeAvailableSchema = z.object({
  organization: z.object({ id: z.string(), name: z.string() }).nullable(),
  teams: z.array(z.object({ id: z.string(), name: z.string() })),
  projects: z.array(z.object({ id: z.string(), name: z.string(), teamId: z.string() })),
});
export type RetentionScopeAvailable = z.infer<typeof retentionScopeAvailableSchema>;

/** Everything one render of the retention settings page is built from. */
export const retentionPolicySnapshotSchema = z.object({
  projectId: z.string(),
  /**
   * Effective per-category retention for this project, falling back to the
   * platform default when no override is set anywhere in the cascade.
   */
  effective: resolvedRetentionSchema,
  /** Override rows the caller can read, one per (scope, category). */
  rules: z.array(retentionRuleSchema),
  /** Scopes the caller can write to (RBAC-filtered), for the chip picker. */
  available: retentionScopeAvailableSchema,
  /**
   * Whether the organization's plan unlocks configurable retention. Free plans
   * see the snapshot but must not be offered the add, edit or delete controls.
   */
  canConfigureRetention: z.boolean(),
});
export type RetentionPolicySnapshot = z.infer<typeof retentionPolicySnapshotSchema>;

/**
 * Stored bytes for the scope the selector resolves to, and how many projects
 * contributed — the card says "across N projects" for a wider scope.
 */
export const retentionStorageUsageSchema = z.object({
  totalBytes: z.number(),
  projectCount: z.number(),
});
export type RetentionStorageUsage = z.infer<typeof retentionStorageUsageSchema>;
