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
 *
 * `join-request` is the opposite case, and deliberately so: somebody asked
 * to join and the request was approved, which is a live change a customer
 * should see. It stays auditable.
 */
export const GRANT_EVENT_SOURCES = [
  "grants-service",
  "scim",
  "invite",
  "join-request",
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
  /**
   * When the grant stops granting, for the tiers that are not RESOURCE
   * (a share link's expiry rides in `resource` alongside the rest of its
   * terms, and always has).
   *
   * ADDITIVE and OPTIONAL, which is the whole contract: every event ever
   * appended lacks this field, and a fact folded without it produces exactly
   * the row it produced before - `Grant.expiresAt` null, granting until
   * revoked. Nothing reads it at fold time either, so a replay of the old
   * stream is byte-identical.
   *
   * Expiry is a READ-side fact. Nothing is written when the moment passes:
   * `revokedAt` stays null, the epoch is not bumped, and the row remains for
   * audit. The collector treats an elapsed row as absent (ADR-092 §2).
   */
  expiresAtMs?: number;
  source: GrantEventSource;
  /** Business time (backfilled facts carry the legacy row's createdAt). */
  occurredAtMs: number;
}

/**
 * One person's membership of one group, as a fact with a beginning and an
 * end (ADR-125's named prerequisite).
 *
 * Two ids, doing two different jobs, and confusing them costs ordering:
 *
 * - `membershipId` is the membership's IDENTITY, minted per fact. The pair
 *   repeats — somebody removed from a group can be added back, and that is a
 *   new membership with its own beginning and its own end, not an edit of the
 *   old one. A second `group_member_added` on the same id would read as a
 *   redelivery and fold to nothing. Its uniqueness over live rows is a partial
 *   unique index.
 * - The PAIR is the AGGREGATE, via `groupMembershipAggregateId` below. Joined,
 *   left, joined again is one relationship with a history, so every change to
 *   it has to ride one FIFO lane in order. Keying the aggregate on
 *   `membershipId` instead would put the remove and the re-add in DIFFERENT
 *   lanes, and nothing would then serialize them.
 *
 * Same rule ADR-110 applies to a grant and to a role — the aggregate is the
 * entity the events are about — read correctly: the entity here is the
 * relationship, not the row recording one instance of it. The membership is
 * org-scoped because the group is: a `Group` row carries an `organizationId`,
 * so `tenantId === organizationId` holds for these commands exactly as it does
 * for the grant ones.
 *
 * No role, no scope, no permissions: a membership grants nothing by itself.
 * What it does is make every grant held by the group reach the user, which is
 * why COLLECT has to fence on it and why the epoch has to move when it
 * changes.
 */
export interface GroupMembershipFact {
  membershipId: string;
  groupId: string;
  userId: string;
  source: GrantEventSource;
  /** Business time (an imported membership carries the legacy row's
   *  createdAt). */
  occurredAtMs: number;
}

/**
 * The AGGREGATE one person's membership of one group belongs to.
 *
 * Not the membership id, and the difference is a security property rather
 * than a naming preference. `queueManager.buildGroupKey` composes
 * `${tenantId}/${jobPath}/${aggregateType}:${key}`, and `serializeByAggregate`
 * makes every command about one aggregate share one FIFO lane by dropping the
 * command name from `jobPath` and forcing the key to this value. So the
 * aggregate id is exactly "which changes must not overtake each other".
 *
 * Keying on the membership id would serialize `added` against the `removed`
 * for the SAME row and stop there — and a re-add is a DIFFERENT row, by
 * design. `remove(M1)` and `add(M2)` for one pair would then sit in two lanes
 * and drain in either order, and the `added` guard (which refuses a second
 * live row for a pair) would silently drop the re-add. The person stays out
 * of the group they were just put back into, with no error anywhere.
 *
 * The PAIR is the entity the events are about — joined, left, joined again is
 * one relationship with a history, not three unrelated things — so the pair is
 * the aggregate and the ordering is total across every change to it.
 *
 * `${groupId}:${userId}` and not a hash: group ids are nanoids and user ids
 * are cuids, neither contains a colon, so the pair round-trips unambiguously
 * (the same reasoning `groupBucketScopeId` states for the gateway's budget
 * keys). The organization is absent because a group belongs to exactly one,
 * and it is already the event's tenant — the first segment of the group key.
 */
export function groupMembershipAggregateId({
  groupId,
  userId,
}: {
  groupId: string;
  userId: string;
}): string {
  return `${groupId}:${userId}`;
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
