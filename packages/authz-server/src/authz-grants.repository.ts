/**
 * ADR-092 — the write port. Atomicity lives in the implementation (the
 * Prisma repository owns transactions,
 * platform/app/src/server/authz/repositories/authz-grants.prisma.repository.ts)
 * while validation, failure naming, and the offboarding proof stay in
 * GrantsService.
 */
import type { RoleBindingScopeType, TeamUserRole } from "@langwatch/authz";
import type { AuthzReadRepository } from "./authz-read.repository";

/** The row shape for a binding INSERT - exactly one principal id set. */
export type RoleBindingWrite = {
  bindingId: string;
  organizationId: string;
  scopeType: RoleBindingScopeType;
  scopeId: string;
  role: TeamUserRole;
  customRoleId: string | null;
  userId: string | null;
  groupId: string | null;
  apiKeyId: string | null;
};

export type BindingPrincipalWhere =
  | { userId: string }
  | { groupId: string }
  | { apiKeyId: string };

/**
 * Thrown by write implementations when a binding INSERT/UPDATE collides
 * with the partial unique indexes. The adapter maps its engine's duplicate
 * signal (Prisma P2002) onto this; GrantsService turns it into the named
 * customer-facing error.
 */
export class DuplicateBindingError extends Error {
  constructor() {
    super("role binding already exists at this scope");
    this.name = "DuplicateBindingError";
  }
}

export type OffboardCounts = {
  bindings: number;
  groupMemberships: number;
  legacyTeamMemberships: number;
  pendingInvites: number;
  organizationMembership: boolean;
};

export interface AuthzGrantsRepository {
  /** @throws DuplicateBindingError on a unique-index collision. */
  createBinding(row: RoleBindingWrite): Promise<void>;
  /** @throws DuplicateBindingError on a unique-index collision. */
  updateBindingRole(args: {
    bindingId: string;
    role: RoleBindingWrite["role"];
    customRoleId: string | null;
  }): Promise<void>;
  deleteBinding(args: { bindingId: string }): Promise<void>;
  findBinding(args: {
    bindingId: string;
  }): Promise<{ id: string; organizationId: string } | null>;
  findCustomRoleOrganization(args: {
    customRoleId: string;
  }): Promise<{ organizationId: string } | null>;
  findTeamOrganization(args: {
    teamId: string;
  }): Promise<{ organizationId: string } | null>;
  findProjectLineage(args: {
    projectId: string;
  }): Promise<{ teamId: string; organizationId: string } | null>;
  /** Delete-then-create as ONE transaction - the REDUCE verb's atomicity. */
  replaceBinding(args: {
    deleteWhere: {
      organizationId: string;
      scopeType: RoleBindingWrite["scopeType"];
      scopeId: string;
      principal: BindingPrincipalWhere;
    };
    create: RoleBindingWrite;
  }): Promise<void>;
  findUserEmail(args: { userId: string }): Promise<string | null>;
  /**
   * Delete every grant source for the user in one transaction, call
   * `prove` with a reader bound to that transaction, and commit only if it
   * returns. A throw from `prove` rolls the whole offboarding back
   * (ADR-092 §10 step 7).
   */
  offboardUser(args: {
    userId: string;
    organizationId: string;
    email: string | null;
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
