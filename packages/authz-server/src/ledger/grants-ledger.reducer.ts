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

export type LedgerPrincipalType =
  | "user"
  | "api_key"
  | "group"
  | "team"
  | "organization"
  | "project"
  | "anyone";

export type LedgerScopeType =
  | "ORGANIZATION"
  | "TEAM"
  | "PROJECT"
  | "RESOURCE"
  | "PLATFORM";

/** Which writer emitted the event. Backfill sources are skipped by the
 *  audit subscriber's when-guard; the reducer treats all sources alike. */
export type GrantEventSource =
  | "grants-service"
  | "scim"
  | "invite"
  | "backfill-b"
  | "genesis-import"
  | "read-through-mint";

export interface LedgerPrincipal {
  type: LedgerPrincipalType;
  /** null only for "anyone" (resource tier). */
  id: string | null;
}

export interface LedgerScope {
  type: LedgerScopeType;
  id: string;
}

/** Resource-tier columns (ShareLink heritage, ADR-057 possession intact). */
export interface ResourceGrantTerms {
  token: string;
  permission: string;
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
      return {
        ...state,
        grants: {
          ...state.grants,
          [event.grantId]: { ...existing, roleKey: event.to },
        },
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
          changedAtMs: event.occurredAtMs,
        },
      };
    case "cutover_completed":
      if (isStaleCutoverFact({ state, event })) return state;
      return {
        ...state,
        cutover: {
          ...state.cutover,
          onEngine: true,
          changedAtMs: event.occurredAtMs,
        },
      };
    case "cutover_rolled_back":
      if (isStaleCutoverFact({ state, event })) return state;
      return {
        ...state,
        cutover: {
          ...state.cutover,
          onEngine: false,
          changedAtMs: event.occurredAtMs,
        },
      };
    case "migration_tenant_state_changed":
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
