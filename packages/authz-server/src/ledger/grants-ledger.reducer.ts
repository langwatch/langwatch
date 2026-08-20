/**
 * The grants ledger's pure reducer (ADR-092 §13).
 *
 * One aggregate per organization. The fold is pure and framework-free: the
 * app's pipeline validates wire events and maps them onto the fact types
 * here; replay and live dispatch run this exact function, which is what
 * makes the replay-determinism proof meaningful.
 *
 * Idempotency is structural: grant and role ids are deterministic functions
 * of event content, applies are absolute writes keyed by those ids, and
 * deletes of absent ids are no-ops. Applying any event twice yields the
 * same state as applying it once.
 *
 * Two removal events also SWEEP by identity rather than trusting the id list
 * their writer resolved from the lagging compat projection: `member_offboarded`
 * takes every grant its principal holds, and `grant_revoked` takes every grant
 * matching its selector when it carries one. Both read only the state this
 * stream produced, in stream order, so a replay reproduces them exactly — see
 * `grantIdsForUser` for the full argument and for what deliberately survives.
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
export type GrantEventSource =
  | "grants-service"
  | "scim"
  | "invite"
  | "backfill-b"
  | "genesis-import"
  | "read-through-mint"
  | "cutover-import";

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
export interface GrantRevocationSelector {
  principal: LedgerPrincipal;
  scope?: LedgerScope;
}

export type GrantsLedgerEvent =
  | {
      kind: "grant_attached";
      grant: GrantFact;
      actor: GrantsLedgerActor;
    }
  | {
      kind: "grant_role_changed";
      grantId: string;
      from: string | null;
      to: string;
      actor: GrantsLedgerActor;
      occurredAtMs: number;
    }
  | {
      kind: "grant_revoked";
      /** The id the caller named. Absent only when the caller revoked by
       *  identity and the lagging projection listed no id at all. */
      grantId?: string;
      /** The identity the caller filtered on, when the filter could be
       *  expressed as one — see `GrantRevocationSelector`. */
      selector?: GrantRevocationSelector;
      reason?: string;
      actor: GrantsLedgerActor;
      occurredAtMs: number;
    }
  | {
      kind: "role_defined";
      role: RoleFact;
      actor: GrantsLedgerActor;
    }
  | {
      kind: "role_permissions_changed";
      roleId: string;
      permissions: string[];
      actor: GrantsLedgerActor;
      occurredAtMs: number;
    }
  | {
      kind: "role_deleted";
      roleId: string;
      actor: GrantsLedgerActor;
      occurredAtMs: number;
    }
  | {
      kind: "member_offboarded";
      userId: string;
      revokedGrantIds: string[];
      actor: GrantsLedgerActor;
      occurredAtMs: number;
    }
  | {
      kind: "migration_parity_proved";
      diffs: string[];
      occurredAtMs: number;
    }
  | {
      kind: "cutover_completed";
      actor: GrantsLedgerActor;
      occurredAtMs: number;
    }
  | {
      kind: "cutover_rolled_back";
      reason?: string;
      actor: GrantsLedgerActor;
      occurredAtMs: number;
    }
  | {
      kind: "migration_tenant_state_changed";
      migrationName: string;
      status: LedgerMigrationStatus;
      report?: unknown;
      actor: GrantsLedgerActor;
      occurredAtMs: number;
    };

/** The runner's per-(migration, tenant) statuses, mirrored so the reducer
 *  never imports the runner package. */
export type LedgerMigrationStatus =
  | "migrated"
  | "finalized"
  | "parked"
  | "rolled_back";

export interface LedgerMigrationTenantState {
  status: LedgerMigrationStatus;
  report?: unknown;
  occurredAtMs: number;
}

export interface GrantsLedgerCutover {
  onEngine: boolean;
  provedAtMs: number | null;
  parityDiffs: string[];
  /**
   * Why the last `cutover_completed` fact did NOT put this organization on
   * the engine, or null when none was refused.
   *
   * The fold is a pure reducer, so a refusal cannot be logged where it
   * happens; it is STATE instead, which is strictly better — the projection
   * carries it to the operator surface, and a replay reproduces it. See
   * `cutoverCompletionRefusal` for what may refuse.
   */
  completionRefusedReason: string | null;
  /**
   * Business time of the newest cutover fact folded so far, and the reducer's
   * own monotonic guard. Unlike the grant and role heads — absolute writes
   * keyed by a deterministic id, where re-applying an old fact is a no-op —
   * the cutover fields are last-write-wins over a single row, so an
   * out-of-order `cutover_rolled_back` would silently take an organization
   * off the engine. Null until the first cutover fact.
   */
  changedAtMs: number | null;
}

export interface GrantsLedgerState {
  organizationId: string;
  grants: Record<string, GrantFact>;
  roles: Record<string, RoleFact>;
  cutover: GrantsLedgerCutover;
  /** Keyed by migration name: the runner lifecycle's witnessed head. */
  migrationStates: Record<string, LedgerMigrationTenantState>;
}

export function emptyGrantsLedgerState({
  organizationId,
}: {
  organizationId: string;
}): GrantsLedgerState {
  return {
    organizationId,
    grants: {},
    roles: {},
    cutover: {
      onEngine: false,
      provedAtMs: null,
      parityDiffs: [],
      completionRefusedReason: null,
      changedAtMs: null,
    },
    migrationStates: {},
  };
}

export function reduceGrantsLedger({
  state,
  event,
}: {
  state: GrantsLedgerState;
  event: GrantsLedgerEvent;
}): GrantsLedgerState {
  switch (event.kind) {
    case "grant_attached":
      return {
        ...state,
        grants: { ...state.grants, [event.grant.grantId]: event.grant },
      };
    case "grant_role_changed": {
      const existing = state.grants[event.grantId];
      if (!existing) return state;
      // `legacyRole` is the pre-migration row's role column, kept only so an
      // adopted fact's compat projection reproduces it (see the field's own
      // doc). Reassigning the role is a decision this ledger now owns, so
      // the pre-migration value stops being meaningful the moment it fires -
      // carrying it forward would let a later custom-role reassignment
      // project as the OLD built-in role instead of CUSTOM (ADR-092 review).
      const updated: GrantFact = { ...existing, roleKey: event.to };
      delete updated.legacyRole;
      return {
        ...state,
        grants: { ...state.grants, [event.grantId]: updated },
      };
    }
    case "grant_revoked":
      return removeGrants({
        state,
        grantIds: [
          ...(event.grantId === undefined ? [] : [event.grantId]),
          ...(event.selector === undefined
            ? []
            : grantIdsMatchingSelector({
                state,
                selector: event.selector,
              })),
        ],
      });
    case "role_defined":
      return {
        ...state,
        roles: { ...state.roles, [event.role.roleId]: event.role },
      };
    case "role_permissions_changed": {
      const existing = state.roles[event.roleId];
      if (!existing) return state;
      return {
        ...state,
        roles: {
          ...state.roles,
          [event.roleId]: { ...existing, permissions: event.permissions },
        },
      };
    }
    case "role_deleted": {
      if (!state.roles[event.roleId]) return state;
      const roles = { ...state.roles };
      delete roles[event.roleId];
      return { ...state, roles };
    }
    case "member_offboarded":
      // The listed ids stay on the event for the audit trail; the fold takes
      // the PRINCIPAL as the truth and sweeps every grant the offboarded user
      // holds at this point in the stream. See `grantIdsForUser`.
      return removeGrants({
        state,
        grantIds: [
          ...event.revokedGrantIds,
          ...grantIdsForUser({ state, userId: event.userId }),
        ],
      });
    case "migration_parity_proved":
      if (isStaleCutoverFact({ state, event })) return state;
      return {
        ...state,
        cutover: {
          ...state.cutover,
          provedAtMs: event.occurredAtMs,
          parityDiffs: event.diffs,
          // A fresh proof retires whatever the last refusal said: the state
          // it complained about no longer holds.
          completionRefusedReason: null,
          changedAtMs: event.occurredAtMs,
        },
      };
    case "cutover_completed": {
      if (isStaleCutoverFact({ state, event })) return state;
      // The precondition lives HERE and nowhere else. Command handlers on
      // this aggregate are pure appends with no state to check against, and
      // the migration's own ordering is a convention a second writer (an ops
      // action, a replayed script, a future caller) is not bound by. Making
      // the FOLD refuse means no path can put an organization on the engine
      // without a clean proof standing behind it, replay included.
      const refusal = cutoverCompletionRefusal(state.cutover);
      if (refusal !== null) {
        // A refusal is a non-event to the monotonic guard: it flips nothing
        // the guard protects, so `changedAtMs` stays put and a proof whose
        // business time trails the refused completion (a slower writer, a
        // skewed clock) still folds instead of being dropped as stale -
        // advancing the guard here would park the organization forever.
        // Only the reason is recorded, for the operator. `onEngine` is left
        // untouched for the same discipline: taking an organization OFF the
        // engine is `cutover_rolled_back`'s decision, never a side effect.
        return {
          ...state,
          cutover: { ...state.cutover, completionRefusedReason: refusal },
        };
      }
      return {
        ...state,
        cutover: {
          ...state.cutover,
          onEngine: true,
          completionRefusedReason: null,
          changedAtMs: event.occurredAtMs,
        },
      };
    }
    case "cutover_rolled_back":
      if (isStaleCutoverFact({ state, event })) return state;
      return {
        ...state,
        cutover: {
          ...state.cutover,
          onEngine: false,
          // A rollback is a decision, not a refusal: whatever a previous
          // completion could not do is no longer the reason this
          // organization is on legacy.
          completionRefusedReason: null,
          changedAtMs: event.occurredAtMs,
        },
      };
    case "migration_tenant_state_changed": {
      if (isStaleMigrationStateFact({ state, event })) return state;
      return {
        ...state,
        migrationStates: {
          ...state.migrationStates,
          [event.migrationName]: {
            status: event.status,
            ...(event.report === undefined ? {} : { report: event.report }),
            occurredAtMs: event.occurredAtMs,
          },
        },
      };
    }
  }
}

/** The refusal codes a `cutover_completed` fact can fold to. Stable strings:
 *  they reach an operator through the projection, and a test asserts the
 *  code, never prose. */
export const CUTOVER_COMPLETION_REFUSALS = {
  UNPROVEN: "parity_unproven",
  DIFFS: "parity_diffs_outstanding",
} as const;

/**
 * Why this organization may not go onto the engine yet, or null when it may.
 *
 * Two ways: no parity proof has been folded at all, or the newest one found
 * disagreements. Both are the same rule from the ADR — the flip is only ever
 * earned by a proof that came back empty — expressed where every writer,
 * every retry and every replay has to pass through it.
 */
function cutoverCompletionRefusal(cutover: GrantsLedgerCutover): string | null {
  if (cutover.provedAtMs === null) return CUTOVER_COMPLETION_REFUSALS.UNPROVEN;
  if (cutover.parityDiffs.length > 0) {
    return CUTOVER_COMPLETION_REFUSALS.DIFFS;
  }
  return null;
}

/**
 * Whether a cutover-family fact is older than the cutover state already
 * folded. Strictly older loses; equal timestamps still apply, so a replay of
 * the same stream converges to the same state rather than dropping the fact
 * that produced it.
 */
function isStaleCutoverFact({
  state,
  event,
}: {
  state: GrantsLedgerState;
  event: { occurredAtMs: number };
}): boolean {
  const { changedAtMs } = state.cutover;
  return changedAtMs !== null && event.occurredAtMs < changedAtMs;
}

/**
 * Whether a runner lifecycle fact is older than the witnessed state already
 * folded for THAT migration name. The same last-write-wins shape as the
 * cutover fields above - one row per migration, arrival order otherwise
 * decides - so it needs the identical monotonic guard: without it a
 * backdated witness could rewrite a migration's status backwards on replay
 * or on an out-of-order redelivery. Equal timestamps still apply, so a
 * replay of the same stream converges.
 */
function isStaleMigrationStateFact({
  state,
  event,
}: {
  state: GrantsLedgerState;
  event: { migrationName: string; occurredAtMs: number };
}): boolean {
  const existing = state.migrationStates[event.migrationName];
  return existing !== undefined && event.occurredAtMs < existing.occurredAtMs;
}

/**
 * Every grant the offboarded user holds in the state folded SO FAR.
 *
 * Why the fold sweeps rather than trusting the event's id list: the writer
 * builds `revokedGrantIds` by querying the compat projection, and that
 * projection lags the ledger by a fold. A grant appended a moment before the
 * offboarding — a team invite accepted, an API key minted — is not in that
 * query's answer, so an id-only removal leaves the departed member holding
 * live access that no later event names.
 *
 * The sweep is deterministic under replay because it reads only the state the
 * stream itself produced, in stream order. That also fixes its meaning
 * exactly: everything the user held UP TO the offboarding fact goes, and a
 * grant attached AFTER it stands. The second half is deliberate — offboarding
 * is a point in time, not a tombstone, and a re-invited member's new grant
 * must not be eaten by an old departure. (The alternative, refusing later
 * attaches for a once-offboarded principal, would need unbounded per-principal
 * state and would make re-onboarding impossible without a new verb.)
 */
function grantIdsForUser({
  state,
  userId,
}: {
  state: GrantsLedgerState;
  userId: string;
}): string[] {
  return Object.values(state.grants)
    .filter(
      (grant) => grant.principal.type === "user" && grant.principal.id === userId,
    )
    .map((grant) => grant.grantId);
}

/**
 * Every grant matching a revoke-by-identity selector in the state folded so
 * far — the same healing as `grantIdsForUser`, for the filter shapes a
 * revocation can express (see `GrantRevocationSelector`), and deterministic
 * for the same reason: it reads only what this stream produced, in order.
 */
function grantIdsMatchingSelector({
  state,
  selector,
}: {
  state: GrantsLedgerState;
  selector: GrantRevocationSelector;
}): string[] {
  return Object.values(state.grants)
    .filter(
      (grant) =>
        grant.principal.type === selector.principal.type &&
        grant.principal.id === selector.principal.id &&
        (selector.scope === undefined ||
          (grant.scope.type === selector.scope.type &&
            grant.scope.id === selector.scope.id)),
    )
    .map((grant) => grant.grantId);
}

function removeGrants({
  state,
  grantIds,
}: {
  state: GrantsLedgerState;
  grantIds: string[];
}): GrantsLedgerState {
  const present = grantIds.filter((id) => state.grants[id] !== undefined);
  if (present.length === 0) return state;
  const grants = { ...state.grants };
  for (const id of present) delete grants[id];
  return { ...state, grants };
}
