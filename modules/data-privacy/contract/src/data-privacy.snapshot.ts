/**
 * What the data-privacy settings page reads, as a portable shape. The
 * browser may import no server package, so the wire shape lives here —
 * the same parser the tRPC declaration publishes, so they cannot drift.
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  dataPrivacyConfigSchema,
  DATA_PRIVACY_SCOPE_TYPES,
  resolvedDataPrivacySchema,
} from "./data-privacy.ts";

/** One stored rule: a scope, whether it covers personal projects, its config. */
const dataPrivacyRuleSchemaDefinition = z
  .object({
    scopeType: z.enum(DATA_PRIVACY_SCOPE_TYPES),
    scopeId: z.string(),
    name: z.string(),
    personalOnly: z.boolean(),
    config: dataPrivacyConfigSchema,
  })
  .strict();
export interface DataPrivacyRuleSchema extends Named<typeof dataPrivacyRuleSchemaDefinition> {}
export const dataPrivacyRuleSchema: DataPrivacyRuleSchema = dataPrivacyRuleSchemaDefinition;
export type DataPrivacyRule = z.infer<typeof dataPrivacyRuleSchema>;

const namedScopeSchema = z.object({ id: z.string(), name: z.string() }).strict();

/**
 * The scopes the caller may write a rule at, RBAC-filtered by the server.
 * Every list empty means the caller may read the page and change nothing —
 * which hides the add and edit controls.
 */
const dataPrivacyScopeAvailableSchemaDefinition = z
  .object({
    organization: namedScopeSchema.nullable(),
    departments: z.array(namedScopeSchema),
    teams: z.array(namedScopeSchema),
    projects: z.array(z.object({ id: z.string(), name: z.string(), teamId: z.string() }).strict()),
  })
  .strict();
export interface DataPrivacyScopeAvailableSchema extends Named<
  typeof dataPrivacyScopeAvailableSchemaDefinition
> {}
export const dataPrivacyScopeAvailableSchema: DataPrivacyScopeAvailableSchema =
  dataPrivacyScopeAvailableSchemaDefinition;
export type DataPrivacyScopeAvailable = z.infer<typeof dataPrivacyScopeAvailableSchema>;

/** The choices the restrict-audience picker offers beyond the built-in roles. */
const dataPrivacyAudienceOptionsSchemaDefinition = z
  .object({
    /**
     * The organization's custom RBAC groups (created on the enterprise plan; an
     * organization without any sees the group control empty and disabled).
     */
    groups: z.array(namedScopeSchema),
  })
  .strict();
export interface DataPrivacyAudienceOptionsSchema extends Named<
  typeof dataPrivacyAudienceOptionsSchemaDefinition
> {}
export const dataPrivacyAudienceOptionsSchema: DataPrivacyAudienceOptionsSchema =
  dataPrivacyAudienceOptionsSchemaDefinition;
export type DataPrivacyAudienceOptions = z.infer<typeof dataPrivacyAudienceOptionsSchema>;

/** Everything one render of the data-privacy settings page is built from. */
const dataPrivacySnapshotSchemaDefinition = z
  .object({
    projectId: z.string(),
    /** The effective policy, every field populated by the cascade or the default. */
    effective: resolvedDataPrivacySchema,
    /**
     * The baseline a project in this team inherits before its own and its
     * department's rules: the cascade stopping at the TEAM tier. Null for a
     * personal-account project that has no team or organization.
     */
    effectiveTeam: resolvedDataPrivacySchema.nullable(),
    /**
     * The organization-wide baseline: only ORGANIZATION rules and the platform
     * defaults. Null for a personal-account project that has no organization.
     */
    effectiveOrganization: resolvedDataPrivacySchema.nullable(),
    /** Rule rows the caller can read, one per (scope, personalOnly). */
    rules: z.array(dataPrivacyRuleSchema),
    /** Scopes the caller can write to (RBAC-filtered), for the chip picker. */
    available: dataPrivacyScopeAvailableSchema,
    /** Choices for the restrict-audience picker. */
    audienceOptions: dataPrivacyAudienceOptionsSchema,
  })
  .strict();
export interface DataPrivacySnapshotSchema extends Named<
  typeof dataPrivacySnapshotSchemaDefinition
> {}
export const dataPrivacySnapshotSchema: DataPrivacySnapshotSchema =
  dataPrivacySnapshotSchemaDefinition;
export type DataPrivacySnapshot = z.infer<typeof dataPrivacySnapshotSchema>;
