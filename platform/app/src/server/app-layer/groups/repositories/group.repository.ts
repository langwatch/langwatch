import type {
  Group,
  GroupMembership,
  RoleBinding,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import type { LedgerActor } from "~/server/app-layer/authz/ledger";

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

  findGroupOnly(params: {
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

  delete(params: { id: string; organizationId: string }): Promise<void>;

  findMembers(params: { groupId: string }): Promise<
    Array<{
      userId: string;
      user: { id: string; name: string | null; email: string | null };
    }>
  >;

  addMember(params: {
    groupId: string;
    userId: string;
  }): Promise<GroupMembership>;

  removeMember(params: { groupId: string; userId: string }): Promise<void>;

  findBindings(params: {
    groupId: string;
  }): Promise<
    Array<RoleBinding & { customRole: { id: string; name: string } | null }>
  >;

  createBinding(
    data: CreateBindingInput,
    context: { actor: LedgerActor },
  ): Promise<CreatedBinding>;

  findBinding(params: {
    id: string;
    organizationId: string;
  }): Promise<RoleBinding | null>;

  deleteBinding(params: {
    id: string;
    organizationId: string;
    actor: LedgerActor;
  }): Promise<void>;

  deleteAllMemberships(params: { groupId: string }): Promise<void>;

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
