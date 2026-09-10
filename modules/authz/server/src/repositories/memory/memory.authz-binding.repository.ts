import type { OrganizationRole, RoleBindingScopeType } from "@langwatch/authz-contract";
import {
  type AuthzAssignableRoleRow,
  type AuthzBindingScopeRow,
  AuthzBindingRepository,
  type AuthzManagedBindingRow,
  type AuthzUserGroupRow,
} from "../authz-binding.repository.ts";
import type { AuthzMemoryStore } from "./authz-memory.store.ts";

/** The binding facts a process without a database keeps in one shared store. */
export class MemoryAuthzBindingRepository extends AuthzBindingRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzBindingRepository {
    return new MemoryAuthzBindingRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  async hasBindingsForUser(input: { organizationId: string; userId: string }): Promise<boolean> {
    return this.memory.bindings.some(
      (row) => row.organizationId === input.organizationId && row.userId === input.userId,
    );
  }

  async hasLegacySharedTeamMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<boolean> {
    return this.memory.legacySharedTeamMemberships.some(
      (row) => row.organizationId === input.organizationId && row.userId === input.userId,
    );
  }

  async findScopeRows(input: {
    organizationId: string;
    scopes: ReadonlyArray<{ scopeType: RoleBindingScopeType; scopeId: string }>;
  }): Promise<AuthzBindingScopeRow[]> {
    return this.memory.scopes
      .filter(
        (row) =>
          row.organizationId === input.organizationId &&
          input.scopes.some((scope) => scope.scopeType === row.type && scope.scopeId === row.id),
      )
      .map(({ organizationId: _organizationId, ...row }) => row);
  }

  async findGroupMembers(input: {
    organizationId: string;
    groupIds: readonly string[];
  }): Promise<Array<{ groupId: string; userId: string }>> {
    return this.memory.groupMemberships
      .filter(
        (row) =>
          row.organizationId === input.organizationId && input.groupIds.includes(row.groupId),
      )
      .map((row) => ({ groupId: row.groupId, userId: row.userId }));
  }

  async findUserGroups(input: {
    organizationId: string;
    userId: string;
  }): Promise<AuthzUserGroupRow[]> {
    return this.memory.groupMemberships
      .filter((row) => row.organizationId === input.organizationId && row.userId === input.userId)
      .map((row) => ({ groupId: row.groupId, group: row.group }));
  }

  async tryFindOrganizationRole(input: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationRole | null> {
    return this.memory.organizationRoles.get(`${input.organizationId}:${input.userId}`) ?? null;
  }

  async isGroupInOrganization(input: {
    organizationId: string;
    groupId: string;
  }): Promise<boolean> {
    return this.memory.groupMemberships.some(
      (row) => row.organizationId === input.organizationId && row.groupId === input.groupId,
    );
  }

  async isApiKeyInOrganization(input: {
    organizationId: string;
    apiKeyId: string;
  }): Promise<boolean> {
    return this.memory.apiKeys.some(
      (row) => row.organizationId === input.organizationId && row.apiKeyId === input.apiKeyId,
    );
  }

  async tryFindBinding(input: {
    organizationId: string;
    bindingId: string;
  }): Promise<AuthzManagedBindingRow | null> {
    return (
      this.memory.bindings.find(
        (row) => row.organizationId === input.organizationId && row.id === input.bindingId,
      ) ?? null
    );
  }

  async findDirectUserBindings(input: {
    organizationId: string;
    userId: string;
    bindingIds: readonly string[];
  }): Promise<AuthzManagedBindingRow[]> {
    return this.memory.bindings.filter(
      (row) =>
        row.organizationId === input.organizationId &&
        row.userId === input.userId &&
        input.bindingIds.includes(row.id),
    );
  }

  async findAssignableRoles(input: {
    organizationId: string;
    roleIds: readonly string[];
  }): Promise<AuthzAssignableRoleRow[]> {
    return this.memory.roles
      .filter(
        (row) => row.organizationId === input.organizationId && input.roleIds.includes(row.id),
      )
      .map((row) => ({ id: row.id, permissions: row.permissions }));
  }
}
