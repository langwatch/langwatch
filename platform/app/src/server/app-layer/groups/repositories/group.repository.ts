import type { LedgerActor } from "@langwatch/actor";
import type {
  Group,
  GroupMembership,
  RoleBinding,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import type { AccessListingBindingRow } from "~/server/app-layer/authz/repositories/access-listing.repository";

export interface GroupWithDetails extends Group {
  _count: { members: number };
  roleBindings: Array<
    RoleBinding & { customRole: { id: string; name: string } | null }
  >;
}

export interface GroupWithMembers extends Group {
  roleBindings: Array<
    RoleBinding & { customRole: { id: string; name: string } | null }
  >;
  members: Array<
    GroupMembership & {
      user: { id: string; name: string | null; email: string | null };
    }
  >;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number };
}

export interface CreateGroupInput {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
}

/**
 * A binding write's echo. The ledger owns the row now, so a write answers
 * with the fact it emitted rather than with a database row it did not write.
 */
export type CreatedBinding = Pick<
  RoleBinding,
  "id" | "role" | "customRoleId" | "scopeType" | "scopeId"
>;

export interface CreateBindingInput {
  id: string;
  organizationId: string;
  groupId: string;
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
  scopeId: string;
}

export interface GroupRepository {
  findAllByOrganization(params: {
    organizationId: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResult<GroupWithDetails>>;

  findById(params: {
    id: string;
    organizationId: string;
  }): Promise<GroupWithMembers | null>;

  /** The LIVE group. A deleted one answers null, everywhere. */
  findGroupOnly(params: {
    id: string;
    organizationId: string;
  }): Promise<Group | null>;

  /**
   * The group row whether or not it has been deleted. The one read that looks
   * past the live fence, so a caller can tell "no such group" apart from "this
   * one is already deleted" and refuse with the right error.
   */
  findIncludingDeleted(params: {
    id: string;
    organizationId: string;
  }): Promise<Group | null>;

  create(data: CreateGroupInput): Promise<Group>;

  createAtomic(params: {
    group: CreateGroupInput;
    bindings: CreateBindingInput[];
    memberIds: string[];
    actor: LedgerActor;
  }): Promise<Group>;

  rename(params: {
    id: string;
    organizationId: string;
    name: string;
    slug: string;
  }): Promise<Group | null>;

  /**
   * MARKS the group deleted; it is never a row deletion. The row has to
   * survive so the marked `GroupMembership` rows it holds are not taken with
   * it — that history is the whole reason a membership removal marks rather
   * than deletes. Bumps the organization's authz epoch.
   */
  delete(params: {
    id: string;
    organizationId: string;
    reason?: string | null;
  }): Promise<void>;

  findMembers(params: { groupId: string }): Promise<
    Array<{
      userId: string;
      user: { id: string; name: string | null; email: string | null };
    }>
  >;

  /**
   * Membership writes carry an actor and an organization now, because they are
   * grant facts: the ledger records who made the change, and the organization
   * is the tenant of the events it appends.
   */
  addMember(params: {
    groupId: string;
    organizationId: string;
    userId: string;
    actor: LedgerActor;
  }): Promise<GroupMembership>;

  removeMember(params: {
    groupId: string;
    organizationId: string;
    userId: string;
    actor: LedgerActor;
  }): Promise<void>;

  findBindings(params: {
    organizationId: string;
    groupId: string;
  }): Promise<AccessListingBindingRow[]>;

  createBinding(params: {
    data: CreateBindingInput;
    actor: LedgerActor;
  }): Promise<CreatedBinding>;

  findBinding(params: {
    id: string;
    organizationId: string;
  }): Promise<RoleBinding | null>;

  deleteBinding(params: {
    id: string;
    organizationId: string;
    actor: LedgerActor;
  }): Promise<void>;

  deleteAllMemberships(params: {
    groupId: string;
    organizationId: string;
    actor: LedgerActor;
  }): Promise<void>;

  deleteAllBindings(params: {
    groupId: string;
    organizationId: string;
    actor: LedgerActor;
  }): Promise<void>;

  isUserInOrganization(params: {
    userId: string;
    organizationId: string;
  }): Promise<boolean>;

  /**
   * Returns true only when every given user belongs to the organization.
   * `userIds` is expected to be deduplicated by the caller and is resolved in a
   * single query.
   */
  areUsersInOrganization(params: {
    organizationId: string;
    userIds: string[];
  }): Promise<boolean>;

  validateScopeInOrganization(params: {
    organizationId: string;
    scopeType: RoleBindingScopeType;
    scopeId: string;
  }): Promise<boolean>;

  /**
   * Whether any of these scopes is a personal team. Group bindings are how a
   * personal workspace would gain a second member by proxy.
   */
  anyScopeIsPersonalTeam(
    scopes: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>,
  ): Promise<boolean>;

  findUniqueSlug(params: {
    organizationId: string;
    baseSlug: string;
    excludeId?: string;
  }): Promise<string>;
}
