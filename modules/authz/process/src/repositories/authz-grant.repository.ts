/**
 * ADR-092 — the write port. Atomicity lives in the implementation (the
 * application-owned AuthZ composition adapter); validation, failure
 * naming, and the offboarding proof stay in GrantsService.
 */
import type { LedgerActor } from "@langwatch/actor";
import {
  BindingMissingError,
  DuplicateBindingError,
  type GrantEventSource,
  type OffboardCounts,
  type RoleBindingScopeType,
  type TeamUserRole,
} from "@langwatch/authz-contract";

import { ScopeLineageRepository } from "./authz-read.repository.ts";
import type { AuthzReadRepository } from "./authz-read.repository.ts";

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
};

/**
 * Thrown by write implementations when a binding INSERT/UPDATE collides
 * with the partial unique indexes. The adapter maps its engine's duplicate
 * signal (Prisma P2002) onto this; GrantsService names it for the customer.
 */
export { BindingMissingError, DuplicateBindingError };
export type { OffboardCounts };

export abstract class AuthzGrantRepository extends ScopeLineageRepository {
  /** @throws DuplicateBindingError on a unique-index collision. */
  abstract createBinding(args: {
    row: RoleBindingWrite;
    actor: LedgerActor;
    source?: GrantEventSource;
  }): Promise<void>;
  /**
   * @throws DuplicateBindingError on a unique-index collision.
   * @throws BindingMissingError when the row is gone.
   */
  abstract updateBindingRole(args: {
    bindingId: string;
    organizationId: string;
    role: RoleBindingWrite["role"];
    customRoleId: string | null;
    actor: LedgerActor;
  }): Promise<void>;
  /** @throws BindingMissingError when the row is gone. */
  abstract deleteBinding(args: {
    bindingId: string;
    organizationId: string;
    actor: LedgerActor;
  }): Promise<void>;
  abstract findBinding(args: {
    bindingId: string;
  }): Promise<{ id: string; organizationId: string } | null>;
  /**
   * A custom role's owning organization and its stored permission payload -
   * the tenancy check and the vocabulary check read the same row, so they
   * take one query.
   */
  abstract findCustomRole(args: {
    customRoleId: string;
  }): Promise<{ organizationId: string; permissions: unknown } | null>;
  /**
   * Delete-then-create as ONE transaction - the REDUCE verb's atomicity.
   * @throws BindingMissingError when the delete matched nothing.
   */
  abstract replaceBinding(args: {
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
   * Delete user grants in one transaction; prove via txn-bound reader;
   * rollback on prove throw (ADR-092 §10 step 7).
   */
  abstract offboardUser(args: {
    userId: string;
    organizationId: string;
    actor: LedgerActor;
    prove: (txReader: AuthzReadRepository) => Promise<void>;
  }): Promise<OffboardCounts>;
  /**
   * The organization-scoped grants the DIRECTORY itself wrote for these
   * people. `source` names the writer, so an administrator's own grant at the
   * same scope is never named; a legacy head records none.
   */
  abstract findDirectoryOrganizationGrantIds(args: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<string[]>;
  /**
   * What the directory attached and took back lately, newest first. The same
   * `source` names the writer, so an administrator's own grant never appears
   * in a view about what the directory did.
   */
  abstract findDirectoryCausedChanges(args: {
    organizationId: string;
    limit: number;
  }): Promise<DirectoryCausedGrantChange[]>;
  abstract findOwnedApiKeys(args: {
    userId: string;
    organizationId: string;
  }): Promise<{ id: string; name: string }[]>;
  abstract findPersonalTeams(args: {
    userId: string;
    organizationId: string;
  }): Promise<{ id: string; name: string }[]>;
}

/** One thing the directory did to a grant, and when. */
export type DirectoryCausedGrantChange = Readonly<{
  grantId: string;
  userId: string | null;
  kind: "attached" | "removed";
  occurredAtMs: number;
}>;
