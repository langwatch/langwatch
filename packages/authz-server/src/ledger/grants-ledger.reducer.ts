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

export interface GrantFact {
  grantId: string;
  principal: LedgerPrincipal;
  /** admin | member | viewer | lite-member | custom:<id>; null only on
   *  resource-tier grants, whose single permission lives in resource. */
  roleKey: string | null;
  scope: LedgerScope;
  resource?: ResourceGrantTerms;
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
      grantId: string;
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
      return removeGrants({ state, grantIds: [event.grantId] });
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
      return removeGrants({ state, grantIds: event.revokedGrantIds });
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
