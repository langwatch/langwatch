/**
 * What the data-privacy settings page reads, as a portable shape.
 *
 * `dataPrivacy.getSnapshot` is answered by a read model that still lives in
 * `platform/app` (`server/data-privacy/dataPrivacyPolicy.read.ts`): it
 * RBAC-filters the rule rows and the writable scopes against organization
 * lineage, which this feature deliberately does not reach into.
 *
 * The browser has to name the shape it renders and may import neither
 * `platform/app` nor a server package, so the wire shape is DECLARED here. That
 * is a restatement rather than a move, and the reason is recorded rather than
 * hidden: the migration ruling forbids editing `platform/app`, so the
 * application's copy cannot be repointed at this one until the read model
 * itself moves into `@langwatch/data-privacy-server`. Until then the two must
 * stay aligned.
 */

import type { DataPrivacyConfig, DataPrivacyScopeType, ResolvedDataPrivacy } from "./data-privacy";

/** One stored rule: a scope, whether it covers personal projects, its config. */
export type DataPrivacyRule = {
  scopeType: DataPrivacyScopeType;
  scopeId: string;
  name: string;
  personalOnly: boolean;
  config: DataPrivacyConfig;
};

/**
 * The scopes the caller may write a rule at, RBAC-filtered by the server.
 *
 * Every list empty means the caller may read the page and change nothing, which
 * is what hides the add and edit controls.
 */
export type DataPrivacyScopeAvailable = {
  organization: { id: string; name: string } | null;
  departments: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  projects: { id: string; name: string; teamId: string }[];
};

/** The choices the restrict-audience picker offers beyond the built-in roles. */
export type DataPrivacyAudienceOptions = {
  /**
   * The organization's custom RBAC groups (created on the enterprise plan; an
   * organization without any sees the group control empty and disabled).
   */
  groups: { id: string; name: string }[];
};

/** Everything one render of the data-privacy settings page is built from. */
export type DataPrivacySnapshot = {
  projectId: string;
  /**
   * The effective policy for this project, every field populated by the cascade
   * or the platform default.
   */
  effective: ResolvedDataPrivacy;
  /**
   * The baseline a project in this team inherits before its own and its
   * department's rules: the cascade stopping at the TEAM tier. Null for a
   * personal-account project that has no team or organization.
   */
  effectiveTeam: ResolvedDataPrivacy | null;
  /**
   * The organization-wide baseline: only ORGANIZATION rules and the platform
   * defaults. Null for a personal-account project that has no organization.
   */
  effectiveOrganization: ResolvedDataPrivacy | null;
  /** Rule rows the caller can read, one per (scope, personalOnly). */
  rules: DataPrivacyRule[];
  /** Scopes the caller can write to (RBAC-filtered), for the chip picker. */
  available: DataPrivacyScopeAvailable;
  /** Choices for the restrict-audience picker. */
  audienceOptions: DataPrivacyAudienceOptions;
};
