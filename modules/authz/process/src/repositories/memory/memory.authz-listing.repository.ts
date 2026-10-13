import type {
  AuthzAccessBinding,
  AuthzAccessUser,
  AuthzBindingForSynthesis,
  AuthzCustomRole,
  AuthzTeamMemberBinding,
  GrantScopeTier,
} from "@langwatch/authz-contract";
import { toDate } from "@langwatch/time";

import { AuthzListingRepository } from "../authz-listing.repository.ts";
import {
  BINDING_PRINCIPAL_TYPES,
  BINDING_SCOPE_TYPES,
  bindingsForSynthesisFrom,
  byOccurredAtThenId,
  collectDecorationIds,
  decoratedBindings,
  type GrantListRow,
  isListableRoleKey,
  type ListableGrant,
  listableGrants,
  roleIdsByOrganization,
  synthesisGrants,
  teamMemberBindingsFrom,
  teamMemberDecorationIds,
  toCustomRoleShape,
  USER_CREATED_ROLE_KIND,
} from "../eventing/eventing.authz-listing.mapper.ts";
import type {
  AuthzMemoryGrantRow,
  AuthzMemoryRoleRow,
  AuthzMemoryStore,
} from "./authz-memory.store.ts";

type GrantMatch = (row: AuthzMemoryGrantRow) => boolean;

/** The access listings over the memory heads, with the grant-head listing's predicates. */
export class MemoryAuthzListingRepository extends AuthzListingRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzListingRepository {
    return new MemoryAuthzListingRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  // Arrow instance properties, matching the base class's property-typed abstract members.
  findUserBindings = async ({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<AuthzAccessBinding[]> => {
    const rows = this.grantRows({
      organizationIds: [organizationId],
      matches: (row) => row.principalType === "USER" && row.principalId === userId,
    });
    return this.decorate({ organizationId, grants: listableGrants(rows) });
  };

  findOrganizationBindings = async ({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AuthzAccessBinding[]> => {
    const rows = this.grantRows({ organizationIds: [organizationId], matches: () => true });
    return this.decorate({
      organizationId,
      grants: listableGrants(rows),
      shouldDropUndecoratedPrincipals: true,
    });
  };

  findUserAndGroupBindings = async ({
    organizationId,
    userId,
    groupIds,
  }: {
    organizationId: string;
    userId: string;
    groupIds: readonly string[];
  }): Promise<AuthzAccessBinding[]> => {
    const rows = this.grantRows({
      organizationIds: [organizationId],
      matches: userOrGroupGrant({ userId, groupIds }),
    });
    return this.decorate({ organizationId, grants: listableGrants(rows) });
  };

  findScopeBindings = async ({
    organizationId,
    scopeType,
    scopeIds,
  }: {
    organizationId: string;
    scopeType: GrantScopeTier;
    scopeIds: readonly string[];
  }): Promise<AuthzAccessBinding[]> => {
    if (scopeIds.length === 0) return [];
    const rows = this.grantRows({
      organizationIds: [organizationId],
      matches: (row) => row.scopeType === scopeType && scopeIds.includes(row.scopeId),
    });
    return this.decorate({
      organizationId,
      grants: listableGrants(rows),
      shouldDropUndecoratedPrincipals: true,
    });
  };

  findGroupBindings = async ({
    organizationId,
    groupId,
  }: {
    organizationId: string;
    groupId: string;
  }): Promise<AuthzAccessBinding[]> => {
    const rows = this.grantRows({
      organizationIds: [organizationId],
      matches: (row) => row.principalType === "GROUP" && row.principalId === groupId,
    });
    return this.decorate({ organizationId, grants: listableGrants(rows) });
  };

  findApiKeyBindings = async ({
    organizationId,
    apiKeyIds,
  }: {
    organizationId: string;
    apiKeyIds: readonly string[];
  }): Promise<AuthzAccessBinding[]> => {
    if (apiKeyIds.length === 0) return [];
    const rows = this.grantRows({
      organizationIds: [organizationId],
      matches: (row) =>
        row.principalType === "API_KEY" &&
        row.principalId !== null &&
        apiKeyIds.includes(row.principalId),
    });
    return this.decorate({ organizationId, grants: listableGrants(rows) });
  };

  findTeamMemberBindings = async ({
    organizationId,
    teamIds,
  }: {
    organizationId: string;
    teamIds: readonly string[];
  }): Promise<Map<string, AuthzTeamMemberBinding[]>> => {
    if (teamIds.length === 0) return new Map();
    const rows = this.grantRows({
      organizationIds: [organizationId],
      matches: (row) =>
        row.principalType === "USER" && row.scopeType === "TEAM" && teamIds.includes(row.scopeId),
    });
    const grants = listableGrants(rows);
    const { userIds, roleIds } = teamMemberDecorationIds(grants);
    return teamMemberBindingsFrom({
      teamIds,
      grants,
      users: this.users({ organizationId, userIds, requireCurrentMembership: true }),
      roles: this.rolesAsCustomRoles({ organizationId, roleIds }),
    });
  };

  findBindingsForSynthesis = async ({
    orgIds,
    userId,
  }: {
    orgIds: readonly string[];
    userId: string;
  }): Promise<AuthzBindingForSynthesis[]> => {
    if (orgIds.length === 0) return [];
    const groupIdsByOrg = new Map<string, Set<string>>();
    for (const membership of this.memory.groupMemberships) {
      const group = this.memory.groups.find((candidate) => candidate.id === membership.groupId);
      if (membership.userId !== userId || !group || !orgIds.includes(group.organizationId)) {
        continue;
      }
      const groupIds = groupIdsByOrg.get(group.organizationId) ?? new Set<string>();
      groupIdsByOrg.set(group.organizationId, groupIds.add(membership.groupId));
    }
    const developerOrgIds = new Set(
      orgIds.filter(
        (orgId) =>
          this.memory.memberships.get(this.memory.membershipKey(orgId, userId))?.role ===
          "DEVELOPER",
      ),
    );
    const allGroupIds = [...groupIdsByOrg.values()].flatMap((ids) => [...ids]);
    const rows = this.grantRows({
      organizationIds: orgIds,
      matches: userOrGroupGrant({ userId, groupIds: allGroupIds }),
    });
    const grants = synthesisGrants({ rows, groupIdsByOrg, developerOrgIds });
    const rolesByOrg = new Map<string, Map<string, AuthzCustomRole>>();
    for (const [orgId, roleIds] of roleIdsByOrganization(grants)) {
      const roles = this.rolesAsCustomRoles({ organizationId: orgId, roleIds: [...roleIds] });
      rolesByOrg.set(orgId, new Map(roles.map((role) => [role.id, role])));
    }
    return bindingsForSynthesisFrom({ grants, rolesByOrg });
  };

  findUserCreatedRoles = async ({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AuthzCustomRole[]> => {
    return this.liveRoles()
      .filter((row) => row.organizationId === organizationId && row.kind === USER_CREATED_ROLE_KIND)
      .toSorted((a, b) => byOccurredAtThenId(b, a))
      .map(toCustomRoleShape);
  };

  findRolePermissionRows = async ({
    organizationId,
    roleIds,
  }: {
    organizationId: string;
    roleIds: readonly string[];
  }): Promise<{ id: string; name: string; permissions: unknown }[]> => {
    if (roleIds.length === 0) return [];
    return this.liveRoles()
      .filter((row) => roleIds.includes(row.id) && row.organizationId === organizationId)
      .map(({ id, name, permissions }) => ({ id, name, permissions: [...permissions] }));
  };

  /** Organization, listable scope tiers and principal kinds, a listable roleKey, then the ask. */
  private grantRows({
    organizationIds,
    matches,
  }: {
    organizationIds: readonly string[];
    matches: GrantMatch;
  }): GrantListRow[] {
    return this.memory.grants
      .filter(
        (row) =>
          row.revokedAt === null &&
          organizationIds.includes(row.organizationId) &&
          (BINDING_SCOPE_TYPES as readonly string[]).includes(row.scopeType) &&
          (BINDING_PRINCIPAL_TYPES as readonly string[]).includes(row.principalType) &&
          isListableRoleKey(row.roleKey) &&
          matches(row),
      )
      .toSorted(byOccurredAtThenId)
      .map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        principalType: row.principalType,
        principalId: row.principalId,
        roleKey: row.roleKey,
        legacyRole: row.legacyRole,
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        expiresAt: row.expiresAt ? toDate(row.expiresAt) : null,
        occurredAt: row.occurredAt,
        updatedAt: row.updatedAt,
      }));
  }

  private decorate({
    organizationId,
    grants,
    shouldDropUndecoratedPrincipals = false,
  }: {
    organizationId: string;
    grants: readonly ListableGrant[];
    shouldDropUndecoratedPrincipals?: boolean;
  }): AuthzAccessBinding[] {
    const ids = collectDecorationIds(grants);
    const users = this.users({
      organizationId,
      userIds: [...ids.user],
      requireCurrentMembership: shouldDropUndecoratedPrincipals,
    });
    const groups = this.memory.groups
      .filter((row) => ids.group.has(row.id) && row.organizationId === organizationId)
      .map(({ id, name, scimSource }) => ({ id, name, scimSource }));
    const apiKeys = this.memory.apiKeys
      .filter((row) => ids.apiKey.has(row.id) && row.organizationId === organizationId)
      .map(({ id, name }) => ({ id, name }));
    const roles = this.rolesAsCustomRoles({ organizationId, roleIds: [...ids.role] });
    return decoratedBindings({
      grants,
      decoration: {
        userById: new Map(users.map((user) => [user.id, user])),
        groupById: new Map(groups.map((group) => [group.id, group])),
        apiKeyById: new Map(apiKeys.map((apiKey) => [apiKey.id, apiKey])),
        roleById: new Map(roles.map((role) => [role.id, role])),
      },
      shouldDropUndecoratedPrincipals,
    });
  }

  /** Per-user reads stay unfenced; whole-table and scope listings exclude departed members. */
  private users({
    organizationId,
    userIds,
    requireCurrentMembership,
  }: {
    organizationId: string;
    userIds: readonly string[];
    requireCurrentMembership: boolean;
  }): AuthzAccessUser[] {
    return this.memory.users
      .filter(
        (user) =>
          userIds.includes(user.id) &&
          (!requireCurrentMembership || this.memory.isMember(organizationId, user.id)),
      )
      .map(({ id, name, email, image }) => ({ id, name, email, image }));
  }

  private rolesAsCustomRoles({
    organizationId,
    roleIds,
  }: {
    organizationId: string;
    roleIds: readonly string[];
  }): AuthzCustomRole[] {
    if (roleIds.length === 0) return [];
    return this.liveRoles()
      .filter((row) => roleIds.includes(row.id) && row.organizationId === organizationId)
      .map((row) => toCustomRoleShape({ ...row, permissions: [...row.permissions] }));
  }

  private liveRoles(): AuthzMemoryRoleRow[] {
    return this.memory.roleHeads.filter((row) => row.deletedAt === null);
  }
}

/** The user's own grants, and their groups' when they are in any. */
function userOrGroupGrant({
  userId,
  groupIds,
}: {
  userId: string;
  groupIds: readonly string[];
}): GrantMatch {
  return (row) =>
    (row.principalType === "USER" && row.principalId === userId) ||
    (row.principalType === "GROUP" &&
      row.principalId !== null &&
      groupIds.includes(row.principalId));
}
