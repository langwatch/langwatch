import {
  emptyGrantsLedgerState,
  type GrantsLedgerState,
  reduceGrantsLedger,
} from "@langwatch/authz-server";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { StateProjectionStore } from "../../../projections/stateProjection.types";
import {
  type AuthzGrantsEvent,
  authzGrantsEventSchema,
  type CutoverCompletedEvent,
  type CutoverRolledBackEvent,
  cutoverCompletedEventSchema,
  cutoverRolledBackEventSchema,
  type GrantAttachedEvent,
  type GrantRevokedEvent,
  type GrantRoleChangedEvent,
  grantAttachedEventSchema,
  grantRevokedEventSchema,
  grantRoleChangedEventSchema,
  type MemberOffboardedEvent,
  type MigrationParityProvedEvent,
  type MigrationTenantStateChangedEvent,
  memberOffboardedEventSchema,
  migrationParityProvedEventSchema,
  migrationTenantStateChangedEventSchema,
  type RoleDefinedEvent,
  type RoleDeletedEvent,
  type RolePermissionsChangedEvent,
  roleDefinedEventSchema,
  roleDeletedEventSchema,
  rolePermissionsChangedEventSchema,
} from "../schemas/events";
import { wireEventToFact } from "./wireToFact";

export const AUTHZ_GRANTS_PROJECTION_VERSION = "2026-08-17" as const;

const authzGrantsEvents = [
  grantAttachedEventSchema,
  grantRoleChangedEventSchema,
  grantRevokedEventSchema,
  roleDefinedEventSchema,
  rolePermissionsChangedEventSchema,
  roleDeletedEventSchema,
  memberOffboardedEventSchema,
  migrationParityProvedEventSchema,
  cutoverCompletedEventSchema,
  cutoverRolledBackEventSchema,
  migrationTenantStateChangedEventSchema,
] as const;

/** The reducer's state plus the base class's bookkeeping stamps. The stamps
 *  stay out of `@langwatch/authz-server` on purpose: the reducer state is
 *  the replay-proof surface, and these three fields are server rig. */
export type AuthzGrantsFoldState = GrantsLedgerState & {
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
};

/**
 * The grants ledger's operational projection (ADR-092 §13): one Postgres
 * state per organization, applied through `.withProjection()`'s direct
 * load/apply/store cycle under the queue's per-org lock (ADR-049 shape).
 *
 * - `implements FoldEventHandlers` enforces a handler for every event schema.
 * - Handler names derive from event type strings (e.g.
 *   `"lw.authz.grants.grant_attached"` → `handleAuthzGrantsGrantAttached`).
 *
 * Every handler is the same move: validate the wire event, reshape it
 * (wireToFact), and hand it to the pure reducer in `@langwatch/authz-server`
 * — live dispatch and the replay test run the identical function, which is
 * what makes replay determinism a meaningful proof. The store writes both
 * heads (Grant/Role and the legacy-shaped compat rows) plus the cursor; see
 * the repository.
 */
export class AuthzGrantsStateFoldProjection
  extends AbstractFoldProjection<
    AuthzGrantsFoldState,
    typeof authzGrantsEvents,
    "CreatedAt",
    "UpdatedAt",
    "LastEventOccurredAt",
    StateProjectionStore<AuthzGrantsFoldState>
  >
  implements FoldEventHandlers<typeof authzGrantsEvents, AuthzGrantsFoldState>
{
  readonly name = "authzGrantsState";
  readonly version = AUTHZ_GRANTS_PROJECTION_VERSION;
  readonly store: StateProjectionStore<AuthzGrantsFoldState>;

  protected readonly events = authzGrantsEvents;

  constructor(deps: { store: StateProjectionStore<AuthzGrantsFoldState> }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
    return emptyGrantsLedgerState({ organizationId: "" });
  }

  private fold(
    event: AuthzGrantsEvent,
    state: AuthzGrantsFoldState,
  ): AuthzGrantsFoldState {
    const parsed = authzGrantsEventSchema.parse(event);
    const next = reduceGrantsLedger({
      state,
      event: wireEventToFact(parsed),
    });
    return {
      ...state,
      ...next,
      // init() cannot know the organization; the first applied event does.
      organizationId:
        next.organizationId === "" ? parsed.aggregateId : next.organizationId,
    };
  }

  handleAuthzGrantsGrantAttached(
    event: GrantAttachedEvent,
    state: AuthzGrantsFoldState,
  ): AuthzGrantsFoldState {
    return this.fold(event, state);
  }

  handleAuthzGrantsGrantRoleChanged(
    event: GrantRoleChangedEvent,
    state: AuthzGrantsFoldState,
  ): AuthzGrantsFoldState {
    return this.fold(event, state);
  }

  handleAuthzGrantsGrantRevoked(
    event: GrantRevokedEvent,
    state: AuthzGrantsFoldState,
  ): AuthzGrantsFoldState {
    return this.fold(event, state);
  }

  handleAuthzGrantsRoleDefined(
    event: RoleDefinedEvent,
    state: AuthzGrantsFoldState,
  ): AuthzGrantsFoldState {
    return this.fold(event, state);
  }

  handleAuthzGrantsRolePermissionsChanged(
    event: RolePermissionsChangedEvent,
    state: AuthzGrantsFoldState,
  ): AuthzGrantsFoldState {
    return this.fold(event, state);
  }

  handleAuthzGrantsRoleDeleted(
    event: RoleDeletedEvent,
    state: AuthzGrantsFoldState,
  ): AuthzGrantsFoldState {
    return this.fold(event, state);
  }

  handleAuthzGrantsMemberOffboarded(
    event: MemberOffboardedEvent,
    state: AuthzGrantsFoldState,
  ): AuthzGrantsFoldState {
    return this.fold(event, state);
  }

  handleAuthzGrantsMigrationParityProved(
    event: MigrationParityProvedEvent,
    state: AuthzGrantsFoldState,
  ): AuthzGrantsFoldState {
    return this.fold(event, state);
  }

  handleAuthzGrantsCutoverCompleted(
    event: CutoverCompletedEvent,
    state: AuthzGrantsFoldState,
  ): AuthzGrantsFoldState {
    return this.fold(event, state);
  }

  handleAuthzGrantsCutoverRolledBack(
    event: CutoverRolledBackEvent,
    state: AuthzGrantsFoldState,
  ): AuthzGrantsFoldState {
    return this.fold(event, state);
  }

  handleAuthzGrantsMigrationTenantStateChanged(
    event: MigrationTenantStateChangedEvent,
    state: AuthzGrantsFoldState,
  ): AuthzGrantsFoldState {
    return this.fold(event, state);
  }
}
