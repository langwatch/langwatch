import type {
  Group,
  GroupMembership,
  RoleBinding,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";

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
  }): Promise<Group>;

  rename(params: {
    id: string;
    organizationId: string;
    name: string;
    slug: string;
  }): Promise<Group | null>;

  delete(params: { id: string; organizationId: string }): Promise<void>;

  findMembers(params: {
    groupId: string;
  }): Promise<
    Array<{
      userId: string;
      user: { id: string; name: string | null; email: string | null };
    }>
  >;

  addMember(params: { groupId: string; userId: string }): Promise<GroupMembership>;

  removeMember(params: { groupId: string; userId: string }): Promise<void>;

  findBindings(params: {
    groupId: string;
  }): Promise<
    Array<
      RoleBinding & { customRole: { id: string; name: string } | null }
    >
  >;

  createBinding(data: CreateBindingInput): Promise<RoleBinding>;

  findBinding(params: {
    id: string;
    organizationId: string;
  }): Promise<RoleBinding | null>;

  deleteBinding(params: { id: string }): Promise<void>;

  deleteAllMemberships(params: { groupId: string }): Promise<void>;

  deleteAllBindings(params: { groupId: string }): Promise<void>;

  isUserInOrganization(params: {
    userId: string;
    organizationId: string;
  }): Promise<boolean>;

  findUniqueSlug(params: {
    organizationId: string;
    baseSlug: string;
    excludeId?: string;
  }): Promise<string>;
}
