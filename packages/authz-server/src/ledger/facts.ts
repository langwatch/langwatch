/**
 * The authorization domain's facts: what a grant IS, what a role IS, and the
 * vocabulary they are written in.
 *
 * Types only. There was a reducer here — the fold that turned an event stream
 * into one organization-wide state — and ADR-110 removed the need for it:
 * every event carries everything needed to apply it to one row, so the
 * projection writes directly and no prior state is ever read. What is left is
 * the shape of the facts themselves, which the projection mapping, the wire
 * schemas and the migration all name.
 */

import type { PrincipalKind, StoredScopeTier } from "@langwatch/authz";

/**
 * The event stream names principals and scopes with the shared vocabulary,
 * not with a private copy of it. Scopes travel in their stored spelling
 * because that is what the projection writes; principals travel canonical.
 */
export type LedgerPrincipalType = PrincipalKind;
export type LedgerScopeType = StoredScopeTier;

/** Which writer emitted the event. Backfill sources are skipped by the
 *  audit subscriber's when-guard; the reducer treats all sources alike.
 *  `cutover-import` is the composite per-org cutover migration's source —
 *  share links, lite members, project credentials and platform operators
 *  arriving as backdated history, so it is skipped like the others. */
/**
 * Which writer authored a fact.
 *
 * `migration` is backdated history: it replaces the genesis-import,
 * backfill-b and cutover-import of the three-migration model ADR-110 folded
 * into one. The audit subscriber skips it, so a customer's audit page does
 * not fill with thousands of rows for changes nobody made.
 */
export const GRANT_EVENT_SOURCES = [
  "grants-service",
  "scim",
  "invite",
  "read-through-mint",
  "migration",
] as const;

export type GrantEventSource = (typeof GRANT_EVENT_SOURCES)[number];

export interface LedgerPrincipal {
  type: LedgerPrincipalType;
  /** null only for "anyone" (resource tier). */
  id: string | null;
}

export interface LedgerScope {
  type: LedgerScopeType;
  id: string;
}

/**
 * Resource-tier columns (ShareLink heritage, ADR-057 possession intact).
 *
 * `scope.id` is the shared resource's id and nothing else, so the fact has
 * to carry the rest of that resource's identity itself: which KIND of thing
 * the id names, and which project it sits in. Both are what the compat
 * ShareLink head projects into its own columns, and what the possession
 * read fences on — a token resolves to one row, but the row still has to
 * prove which project it belongs to. `createdByUserId` is the person who
 * minted the link (absent when nobody did).
 */
export interface ResourceGrantTerms {
  /** The ledger's lowercase spelling; the stored column keeps ShareLink's
   *  uppercase one (TRACE / THREAD). */
  kind: "trace" | "thread";
  projectId: string;
  token: string;
  permission: string;
  createdByUserId?: string;
  expiresAtMs?: number;
  maxViews?: number;
}

/** The legacy `RoleBinding.role` / `TeamUser.role` vocabulary, mirrored so
 *  the reducer never imports the enum. */
export type LegacyBindingRole = "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";

export interface GrantFact {
  grantId: string;
  principal: LedgerPrincipal;
  /** admin | member | viewer | lite-member | custom:<id>; null only on
   *  resource-tier grants, whose single permission lives in resource. */
  roleKey: string | null;
  scope: LedgerScope;
  resource?: ResourceGrantTerms;
  /**
   * The `role` column an IMPORTED binding carried before the ledger owned it.
   * Set only where `roleKey` is `custom:<id>` and the fact came from a legacy
   * row, and read only by the compat head.
   *
   * A custom binding's roleKey cannot express its role column: `custom:<id>`
   * says which custom role, not which built-in role the row also carried. The
   * legacy resolver reads both — a custom role with an EMPTY permission list
   * falls through to `builtinRoleGrants(roleKeyForTeamRole(row.role))` — so a
   * compat row normalized to CUSTOM answers `viewer` where the legacy row
   * answered `admin`. Carrying the original through the FACT (never through a
   * read at fold time) is what keeps that decision identical and the replay
   * deterministic.
   */
  legacyRole?: LegacyBindingRole;
  source: GrantEventSource;
  /** Business time (backfilled facts carry the legacy row's createdAt). */
  occurredAtMs: number;
}

export interface RoleFact {
  roleId: string;
  name: string;
  description?: string;
  /** Registry permission strings only. Empty grants nothing (deny). */
  permissions: string[];
  kind: "custom" | "system_api_key";
  occurredAtMs: number;
}

export interface GrantsLedgerActor {
  type: "user" | "system";
  id: string | null;
}

/**
 * Which grants a revocation names by IDENTITY rather than by id.
 *
 * A revoke-by-filter resolves its ids from the compat projection, which lags
 * the ledger: a grant appended a moment earlier and not yet folded is
 * invisible to that query, so an id list alone leaves it standing. The
 * selector travels on the event, so the FOLD — which sees the state the
 * stream itself produced — removes every grant matching the identity the
 * caller actually filtered on.
 *
 * `principal` is required (a selector with no subject would be a
 * revoke-everything); `scope` narrows it to one scope when the caller filtered
 * on one.
 */


/**
 * The runner's per-(migration, tenant) status vocabulary, mirrored from
 * @langwatch/system-migrations rather than imported: the authz side must not
 * couple to the runner package.
 */
export type MigrationTenantStatus =
  | "migrated"
  | "finalized"
  | "parked"
  | "rolled_back";
