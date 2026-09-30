import type { OrganizationRole, GrantScopeTier } from "@langwatch/authz-contract";

import {
  type AuthzAssignableRoleRow,
  type AuthzBindingScopeRow,
  AuthzManagedGrantRepository,
  type AuthzGrantPrincipalRow,
  type AuthzManagedBindingRow,
  type AuthzUserGroupRow,
} from "../authz-managed-grant.repository.ts";
import type { AuthzMemoryStore } from "./authz-memory.store.ts";

/** The binding facts a process without a database keeps in one shared store. */
export class MemoryAuthzManagedGrantRepository extends AuthzManagedGrantRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzManagedGrantRepository {
    return new MemoryAuthzManagedGrantRepository(options.memory);
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
    scopes: readonly { scopeType: GrantScopeTier; scopeId: string }[];
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
  }): Promise<{ groupId: string; userId: string }[]> {
    return this.memory.groupMemberships
      .filter(
        (row) =>
          row.organizationId === input.organizationId && input.groupIds.includes(row.groupId),
      )
      .map((row) => ({ groupId: row.groupId, userId: row.userId }));
  }

  async findOrganizationUserIds(input: { organizationId: string }): Promise<string[]> {
    const prefix = `${input.organizationId}:`;
    return [...this.memory.organizationRoles.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }

  async findGrantPrincipals(input: {
    organizationId: string;
    grantIds: readonly string[];
  }): Promise<AuthzGrantPrincipalRow[]> {
    return this.memory.bindings
      .filter(
        (row) => row.organizationId === input.organizationId && input.grantIds.includes(row.id),
      )
      .flatMap((row): AuthzGrantPrincipalRow[] => {
        if (row.userId) return [{ grantId: row.id, principal: { type: "user", id: row.userId } }];
        if (row.groupId)
          return [{ grantId: row.id, principal: { type: "group", id: row.groupId } }];
        if (row.apiKeyId) {
          return [{ grantId: row.id, principal: { type: "apiKey", id: row.apiKeyId } }];
        }
        return [];
      });
  }

  async findUserGroups(input: {
    organizationId: string;
    userId: string;
  }): Promise<AuthzUserGroupRow[]> {
    return this.memory.groupMemberships
      .filter((row) => row.organizationId === input.organizationId && row.userId === input.userId)
      .map((row) => ({ groupId: row.groupId, group: row.group }));
  }

  async findOrganizationRole(input: {
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

  async findBinding(input: {
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
