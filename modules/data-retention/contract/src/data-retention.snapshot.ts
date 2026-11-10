/**
 * What the retention settings page reads. Schemas rather than bare types
 * because `data-retention.trpc.ts` states two answers with them, and the
 * browser reads that declaration as its client's types.
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  resolvedRetentionSchema,
  retentionCategorySchema,
  retentionScopeSchema,
} from "./data-retention.ts";

/** One scope a retention rule can be bound to, named for a reader. */
const retentionScopeRefSchemaDefinition = z.object({
  scopeType: retentionScopeSchema,
  scopeId: z.string(),
  name: z.string(),
});
export interface RetentionScopeRefSchema extends Named<typeof retentionScopeRefSchemaDefinition> {}
export const retentionScopeRefSchema: RetentionScopeRefSchema = retentionScopeRefSchemaDefinition;
export type RetentionScopeRef = z.infer<typeof retentionScopeRefSchema>;

/** One stored override: a scope, a category, and the days it keeps. */
const retentionRuleSchemaDefinition = z.object({
  ...retentionScopeRefSchema.shape,
  category: retentionCategorySchema,
  retentionDays: z.number(),
});
export interface RetentionRuleSchema extends Named<typeof retentionRuleSchemaDefinition> {}
export const retentionRuleSchema: RetentionRuleSchema = retentionRuleSchemaDefinition;
export type RetentionRule = z.infer<typeof retentionRuleSchema>;

/**
 * The scopes the caller may write an override at, RBAC-filtered by the server.
 * A caller who may write nowhere gets every list empty, which is what the page
 * reads to decide whether to offer the add and edit controls at all.
 */
const retentionScopeAvailableSchemaDefinition = z.object({
  organization: z.object({ id: z.string(), name: z.string() }).nullable(),
  teams: z.array(z.object({ id: z.string(), name: z.string() })),
  projects: z.array(z.object({ id: z.string(), name: z.string(), teamId: z.string() })),
});
export interface RetentionScopeAvailableSchema extends Named<
  typeof retentionScopeAvailableSchemaDefinition
> {}
export const retentionScopeAvailableSchema: RetentionScopeAvailableSchema =
  retentionScopeAvailableSchemaDefinition;
export type RetentionScopeAvailable = z.infer<typeof retentionScopeAvailableSchema>;

/** Everything one render of the retention settings page is built from. */
const retentionPolicySnapshotSchemaDefinition = z.object({
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
export interface RetentionPolicySnapshotSchema extends Named<
  typeof retentionPolicySnapshotSchemaDefinition
> {}
export const retentionPolicySnapshotSchema: RetentionPolicySnapshotSchema =
  retentionPolicySnapshotSchemaDefinition;
export type RetentionPolicySnapshot = z.infer<typeof retentionPolicySnapshotSchema>;

/**
 * Stored bytes for the scope the selector resolves to, and how many projects
 * contributed — the card says "across N projects" for a wider scope.
 */
const retentionStorageUsageSchemaDefinition = z.object({
  totalBytes: z.number(),
  projectCount: z.number(),
});
export interface RetentionStorageUsageSchema extends Named<
  typeof retentionStorageUsageSchemaDefinition
> {}
export const retentionStorageUsageSchema: RetentionStorageUsageSchema =
  retentionStorageUsageSchemaDefinition;
export type RetentionStorageUsage = z.infer<typeof retentionStorageUsageSchema>;

/**
 * Stored rows a scope's projects keep past their resolved retention, per category: what applying
 * the period to stored data would delete. `retentionDays` is null when the projects differ.
 */
const storedPastRetentionSchemaDefinition = z.object({
  categories: z.array(
    z.object({
      category: retentionCategorySchema,
      rows: z.number().int().nonnegative(),
      retentionDays: z.number().int().nonnegative().nullable(),
    }),
  ),
  projectCount: z.number().int().nonnegative(),
});
export interface StoredPastRetentionSchema extends Named<
  typeof storedPastRetentionSchemaDefinition
> {}
export const storedPastRetentionSchema: StoredPastRetentionSchema =
  storedPastRetentionSchemaDefinition;
export type StoredPastRetention = z.infer<typeof storedPastRetentionSchema>;

/**
 * What an organization stores today and how many days of data that is, so the upgrade dialog
 * can price a longer retention before the buyer picks it.
 */
const organizationStorageEstimateSchemaDefinition = z.object({
  totalBytes: z.number().nonnegative(),
  /** The organization's traces retention, or its age in days when it is younger than that. */
  coveredDays: z.number().int().positive(),
});
export interface OrganizationStorageEstimateSchema extends Named<
  typeof organizationStorageEstimateSchemaDefinition
> {}
export const organizationStorageEstimateSchema: OrganizationStorageEstimateSchema =
  organizationStorageEstimateSchemaDefinition;
export type OrganizationStorageEstimate = z.infer<typeof organizationStorageEstimateSchema>;

/** The traces retention the organization keeps, as the plan card names it; 0 keeps it forever. */
const organizationRetentionSchemaDefinition = z.object({
  retentionDays: z.number().int().nonnegative(),
});
export interface OrganizationRetentionSchema extends Named<
  typeof organizationRetentionSchemaDefinition
> {}
export const organizationRetentionSchema: OrganizationRetentionSchema =
  organizationRetentionSchemaDefinition;
export type OrganizationRetention = z.infer<typeof organizationRetentionSchema>;
