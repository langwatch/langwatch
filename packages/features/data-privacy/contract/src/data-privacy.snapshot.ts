/**
 * What the data-privacy settings page reads, as a portable shape.
 *
 * The browser names the shape it renders and may import no server package, so
 * the wire shape is declared here — the same parser the tRPC declaration
 * publishes as its answer, so the page and the door cannot drift apart.
 */

import { z } from "zod";
import {
  dataPrivacyConfigSchema,
  DATA_PRIVACY_SCOPE_TYPES,
  resolvedDataPrivacySchema,
} from "./data-privacy.ts";

/** One stored rule: a scope, whether it covers personal projects, its config. */
export const dataPrivacyRuleSchema = z
  .object({
    scopeType: z.enum(DATA_PRIVACY_SCOPE_TYPES),
    scopeId: z.string(),
    name: z.string(),
    personalOnly: z.boolean(),
    config: dataPrivacyConfigSchema,
  })
  .strict();
export type DataPrivacyRule = z.infer<typeof dataPrivacyRuleSchema>;

const namedScopeSchema = z.object({ id: z.string(), name: z.string() }).strict();

/**
 * The scopes the caller may write a rule at, RBAC-filtered by the server.
 *
 * Every list empty means the caller may read the page and change nothing, which
 * is what hides the add and edit controls.
 */
export const dataPrivacyScopeAvailableSchema = z
  .object({
    organization: namedScopeSchema.nullable(),
    departments: z.array(namedScopeSchema),
    teams: z.array(namedScopeSchema),
    projects: z.array(z.object({ id: z.string(), name: z.string(), teamId: z.string() }).strict()),
  })
  .strict();
export type DataPrivacyScopeAvailable = z.infer<typeof dataPrivacyScopeAvailableSchema>;

/** The choices the restrict-audience picker offers beyond the built-in roles. */
export const dataPrivacyAudienceOptionsSchema = z
  .object({
    /**
     * The organization's custom RBAC groups (created on the enterprise plan; an
     * organization without any sees the group control empty and disabled).
     */
    groups: z.array(namedScopeSchema),
  })
  .strict();
export type DataPrivacyAudienceOptions = z.infer<typeof dataPrivacyAudienceOptionsSchema>;

/** Everything one render of the data-privacy settings page is built from. */
export const dataPrivacySnapshotSchema = z
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
export type DataPrivacySnapshot = z.infer<typeof dataPrivacySnapshotSchema>;
