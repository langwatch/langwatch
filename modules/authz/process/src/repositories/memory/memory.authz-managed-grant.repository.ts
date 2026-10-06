import type { OrganizationRole } from "@langwatch/authorization";
import { type GrantScopeTier, PRINCIPAL_KIND_FROM_STORED } from "@langwatch/authz-contract";

import {
  type AuthzAssignableRoleRow,
  type AuthzBindingScopeRow,
  AuthzManagedGrantRepository,
  type AuthzGrantPrincipalRow,
  type AuthzManagedBindingRow,
  type AuthzUserGroupRow,
} from "../authz-managed-grant.repository.ts";
import type { AuthzMemoryBindingRow, AuthzMemoryStore } from "./authz-memory.store.ts";

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
    return this.memory.teamMemberships.some(
      (row) =>
        row.userId === input.userId &&
        this.memory.teams.some(
          (team) =>
            team.id === row.teamId &&
            team.organizationId === input.organizationId &&
            !team.isPersonal,
        ),
    );
  }

  async findScopeRows(input: {
    organizationId: string;
    scopes: readonly { scopeType: GrantScopeTier; scopeId: string }[];
  }): Promise<AuthzBindingScopeRow[]> {
    const asked = (scopeType: GrantScopeTier, id: string) =>
      input.scopes.some((scope) => scope.scopeType === scopeType && scope.scopeId === id);
    const organization = this.memory.organizations.get(input.organizationId);
    const teamsHere = this.memory.teams.filter(
      (team) => team.organizationId === input.organizationId,
    );
    return [
      ...(organization && asked("ORGANIZATION", input.organizationId)
        ? [
            {
              type: "ORGANIZATION" as const,
              id: input.organizationId,
              name: organization.name,
              personalWorkspaceName: null,
            },
          ]
        : []),
      ...teamsHere
        .filter((team) => asked("TEAM", team.id))
        .map((team): AuthzBindingScopeRow => ({
          type: "TEAM",
          id: team.id,
          name: team.name,
          personalWorkspaceName: team.isPersonal ? team.name : null,
        })),
      ...this.memory.projects.flatMap((project): AuthzBindingScopeRow[] => {
        const team = teamsHere.find((candidate) => candidate.id === project.teamId);
        if (!team || !asked("PROJECT", project.id)) return [];
        const personal = project.isPersonal || team.isPersonal;
        return [
          {
            type: "PROJECT",
            id: project.id,
            name: project.name,
            personalWorkspaceName: personal ? team.name : null,
          },
        ];
      }),
    ];
  }

  async findGroupMembers(input: {
    organizationId: string;
    groupIds: readonly string[];
  }): Promise<{ groupId: string; userId: string }[]> {
    return this.memory.groupMemberships
      .filter(
        (row) =>
          input.groupIds.includes(row.groupId) &&
          this.memory.isGroupIn(row.groupId, input.organizationId) &&
          this.memory.isMember(input.organizationId, row.userId),
      )
      .map((row) => ({ groupId: row.groupId, userId: row.userId }));
  }

  async findTeamMembers(input: {
    organizationId: string;
    teamIds: readonly string[];
  }): Promise<{ teamId: string; userId: string }[]> {
    return this.memory.teamMemberships
      .filter(
        (row) =>
          input.teamIds.includes(row.teamId) &&
          this.memory.isTeamIn(row.teamId, input.organizationId) &&
          this.memory.isMember(input.organizationId, row.userId),
      )
      .map((row) => ({ teamId: row.teamId, userId: row.userId }));
  }

  async findRoleHolderPrincipals(input: {
    organizationId: string;
    roleId: string;
    limit: number;
  }): Promise<AuthzGrantPrincipalRow["principal"][]> {
    const distinct = new Map(
      this.memory.grants
        .filter(
          (row) =>
            row.organizationId === input.organizationId &&
            row.roleKey === `custom:${input.roleId}` &&
            row.revokedAt === null,
        )
        .map(({ principalType, principalId }) => {
          const type = PRINCIPAL_KIND_FROM_STORED[principalType];
          return [`${type}:${principalId}`, { type, id: principalId }] as const;
        }),
    );
    return [...distinct.values()].slice(0, input.limit);
  }

  async findOrganizationUserIds(input: { organizationId: string }): Promise<string[]> {
    const prefix = `${input.organizationId}:`;
    return [...this.memory.memberships.keys()]
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
    return this.memory.groupMemberships.flatMap((row) => {
      const group = this.memory.groups.find((candidate) => candidate.id === row.groupId);
      if (row.userId !== input.userId || group?.organizationId !== input.organizationId) return [];
      const { id, name, slug, scimSource } = group;
      return [{ groupId: row.groupId, group: { id, name, slug, scimSource } }];
    });
  }

  async findOrganizationRole(input: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationRole | null> {
    const key = this.memory.membershipKey(input.organizationId, input.userId);
    return this.memory.memberships.get(key)?.role ?? null;
  }

  async isGroupInOrganization(input: {
    organizationId: string;
    groupId: string;
  }): Promise<boolean> {
    return this.memory.groups.some(
      (row) => row.organizationId === input.organizationId && row.id === input.groupId,
    );
  }

  async isApiKeyInOrganization(input: {
    organizationId: string;
    apiKeyId: string;
  }): Promise<boolean> {
    return this.memory.apiKeys.some(
      (row) => row.organizationId === input.organizationId && row.id === input.apiKeyId,
    );
  }

  async findBinding(input: {
    organizationId: string;
    bindingId: string;
  }): Promise<AuthzManagedBindingRow | null> {
    const row = this.memory.bindings.find(
      (candidate) =>
        candidate.organizationId === input.organizationId && candidate.id === input.bindingId,
    );
    return row ? bindingFrom(row) : null;
  }

  async findDirectUserBindings(input: {
    organizationId: string;
    userId: string;
    bindingIds: readonly string[];
  }): Promise<AuthzManagedBindingRow[]> {
    return this.memory.bindings
      .filter(
        (row) =>
          row.organizationId === input.organizationId &&
          row.userId === input.userId &&
          input.bindingIds.includes(row.id),
      )
      .map(bindingFrom);
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

function bindingFrom({
  createdAt: _createdAt,
  ...row
}: AuthzMemoryBindingRow): AuthzManagedBindingRow {
  return row;
}
