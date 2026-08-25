/**
 * ADR-092 — the write port. Atomicity lives in the implementation
 * (platform/app/src/server/app-layer/authz/repositories/authz-grants.ledger.repository.ts)
 * while validation, failure naming, and the offboarding proof stay in
 * GrantsService.
 */
import type { LedgerActor } from "@langwatch/actor";
import type { RoleBindingScopeType, TeamUserRole } from "@langwatch/authz";
import type {
  AuthzReadRepository,
  ScopeLineageRepository,
} from "./authz-read.repository";
import type { GrantEventSource } from "./ledger/facts";

/** Which principal a binding row points at. Exactly one, by construction -
 *  the `?: never` exclusions are what make "two principals on one row"
 *  unrepresentable. A bare union would not: excess-property checks skip
 *  variables, so `{ userId, groupId }` passed by reference would type-check
 *  and the adapter would write both columns. */
export type BindingPrincipalWhere =
  | { userId: string; groupId?: never; apiKeyId?: never }
  | { userId?: never; groupId: string; apiKeyId?: never }
  | { userId?: never; groupId?: never; apiKeyId: string };

/** The row shape for a binding INSERT. The adapter spreads `principal` onto
 *  its three nullable columns; the union is the only place that mapping is
 *  allowed to reintroduce nulls. */
export type RoleBindingWrite = {
  bindingId: string;
  organizationId: string;
  scopeType: RoleBindingScopeType;
  scopeId: string;
  role: TeamUserRole;
  customRoleId: string | null;
  principal: BindingPrincipalWhere;
  /**
   * When the binding stops granting (ADR-092's expiring bindings). Optional,
   * and absent on every existing call site: a binding without one grants
   * until it is revoked, exactly as before.
   *
   * It is NOT part of the binding's identity - the partial unique indexes
   * key on (principal, scope, role) and nothing else - so re-declaring the
   * same binding with a different expiry is still a duplicate, and answers
   * 409 rather than quietly re-dating a grant somebody else made.
   */
  expiresAtMs?: number;
};

/**
 * Thrown by write implementations when a binding INSERT/UPDATE collides
 * with the partial unique indexes. The adapter maps its engine's duplicate
 * signal (Prisma P2002) onto this; GrantsService turns it into the named
 * customer-facing error.
 */
export class DuplicateBindingError extends Error {
  /**
   * `rethrowKnownWriteFailure` (grant-validation.ts) lifts this into the
   * customer-facing `DuplicateGrantError` by CODE, not `instanceof` - even
   * though both classes live in this same package today, matching by code
   * is what keeps the lift working unchanged if either side ever crosses a
   * process, a worker, or a serialisation boundary where `instanceof` stops
   * being reliable. The two carry the same code on purpose so the lift is a
   * straight equality check, not a lookup.
   */
  readonly code = "role_binding_already_exists" as const;

  constructor() {
    super("role binding already exists at this scope");
    this.name = "DuplicateBindingError";
  }
}

/**
 * Thrown by write implementations when the row a write targets is not there
 * - the adapter maps its engine's missing-row signal (Prisma P2025, or an
 * update/delete that touched zero rows) onto this. GrantsService turns it
 * into the same not-found error a pre-read miss produces, so a binding
 * deleted between the read and the write reads identically to one that was
 * never there.
 */
export class BindingMissingError extends Error {
  /** Matched by CODE, same as `DuplicateBindingError.code` - see there for
   *  why. */
  readonly code = "role_binding_not_found" as const;

  constructor() {
    super("role binding no longer exists");
    this.name = "BindingMissingError";
  }
}


export type OffboardCounts = {
  bindings: number;
  groupMemberships: number;
  legacyTeamMemberships: number;
  pendingInvites: number;
  organizationMembership: boolean;
};

export interface AuthzGrantsRepository extends ScopeLineageRepository {
  /**
   * @throws DuplicateBindingError on a unique-index collision.
   *
   * `source` is the grant's provenance — which surface authored the fact,
   * stamped onto it alongside the actor. Optional so every existing caller
   * keeps its meaning; GrantsService fills it with `"grants-service"`.
   */
  createBinding(args: {
    row: RoleBindingWrite;
    actor: LedgerActor;
    source?: GrantEventSource;
  }): Promise<void>;
  /**
   * @throws DuplicateBindingError on a unique-index collision.
   * @throws BindingMissingError when the row is gone.
   */
  updateBindingRole(args: {
    bindingId: string;
    organizationId: string;
    role: RoleBindingWrite["role"];
    customRoleId: string | null;
    actor: LedgerActor;
  }): Promise<void>;
  /** @throws BindingMissingError when the row is gone. */
  deleteBinding(args: {
    bindingId: string;
    organizationId: string;
    actor: LedgerActor;
  }): Promise<void>;
  findBinding(args: {
    bindingId: string;
  }): Promise<{ id: string; organizationId: string } | null>;
  /**
   * A custom role's owning organization and its stored permission payload -
   * the tenancy check and the vocabulary check read the same row, so they
   * take one query.
   */
  findCustomRole(args: {
    customRoleId: string;
  }): Promise<{ organizationId: string; permissions: unknown } | null>;
  /**
   * Delete-then-create as ONE transaction - the REDUCE verb's atomicity.
   * @throws BindingMissingError when the delete matched nothing.
   */
  replaceBinding(args: {
    deleteWhere: {
      organizationId: string;
      scopeType: RoleBindingWrite["scopeType"];
      scopeId: string;
      principal: BindingPrincipalWhere;
    };
    create: RoleBindingWrite;
    actor: LedgerActor;
  }): Promise<void>;
  /**
   * Delete every grant source for the user in one transaction, call
   * `prove` with a reader bound to that transaction, and commit only if it
   * returns. A throw from `prove` rolls the whole offboarding back
   * (ADR-092 §10 step 7).
   *
   * Pending invites are keyed by email rather than by user id, so the
   * implementation reads the address INSIDE its own transaction: a pre-read
   * here would let an email change between the read and the deletes leave
   * an invite behind that the proof cannot see.
   */
  offboardUser(args: {
    userId: string;
    organizationId: string;
    actor: LedgerActor;
    prove: (txReader: AuthzReadRepository) => Promise<void>;
  }): Promise<OffboardCounts>;
  findOwnedApiKeys(args: {
    userId: string;
    organizationId: string;
  }): Promise<Array<{ id: string; name: string }>>;
  findPersonalTeams(args: {
    userId: string;
    organizationId: string;
  }): Promise<Array<{ id: string; name: string }>>;
}
