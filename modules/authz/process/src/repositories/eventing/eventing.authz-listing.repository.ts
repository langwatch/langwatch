// Lists cut-over organizations from ledger projection, translating to legacy vocabulary.
import type {
  AuthzAccessApiKey,
  AuthzAccessBinding,
  AuthzAccessGroup,
  AuthzAccessUser,
  AuthzBindingForSynthesis,
  AuthzCustomRole,
  AuthzTeamMemberBinding,
  GrantScopeTier,
} from "@langwatch/authz-contract";
import { type Instant, fromDate } from "@langwatch/time";
import { z } from "zod";

import { AuthzListingRepository } from "../authz-listing.repository.ts";
import type { AuthzDatabase } from "../authz-read.repository.ts";
import {
  BINDING_PRINCIPAL_TYPES,
  BINDING_SCOPE_TYPES,
  bindingsForSynthesisFrom,
  collectDecorationIds,
  type Decoration,
  type DecorationIds,
  decoratedBindings,
  type GrantListRow,
  LISTABLE_BUILT_IN_ROLE_KEYS,
  type ListableGrant,
  listableGrants,
  roleIdsByOrganization,
  type RoleHeadListRow,
  synthesisGrants,
  teamMemberBindingsFrom,
  teamMemberDecorationIds,
  toCustomRoleShape,
  USER_CREATED_ROLE_KIND,
} from "./eventing.authz-listing.mapper.ts";
import { liveGrants, liveRoles } from "./eventing.authz-live-rows.mapper.ts";

const ACCESS_LISTING_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;
const ACCESS_LISTING_GROUP_SELECT = {
  id: true,
  name: true,
  scimSource: true,
} as const;
const ACCESS_LISTING_API_KEY_SELECT = { id: true, name: true } as const;

/** The roleKey shapes the legacy vocabulary can carry: the three built-ins
 *  and `custom:<id>`. Everything else (`lite-member`, null) is dormant. */
const LISTABLE_ROLE_KEY_WHERE = {
  OR: [
    { roleKey: { in: [...LISTABLE_BUILT_IN_ROLE_KEYS] } },
    { roleKey: { startsWith: "custom:" } },
  ],
};

const GRANT_ROW_SELECT = {
  id: true,
  organizationId: true,
  principalType: true,
  principalId: true,
  roleKey: true,
  legacyRole: true,
  scopeType: true,
  scopeId: true,
  expiresAt: true,
  occurredAt: true,
  updatedAt: true,
} as const;

export class EventingAuthzListingRepository extends AuthzListingRepository {
  static create(database: AuthzDatabase): EventingAuthzListingRepository {
    return new EventingAuthzListingRepository(database);
  }

  private constructor(private readonly database: AuthzDatabase) {
    super();
  }

  // Arrow instance properties, matching the base class's property-typed
  // abstract members (AuthzListingRepository declares them that way for
  // test mocks).
  findUserBindings = async ({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<AuthzAccessBinding[]> => {
    const rows = await this.findGrantRows({
      organizationId,
      where: { principalType: "USER", principalId: userId },
    });
    // The legacy query carries no membership predicate on this read - the
    // caller already scoped the ask to a member - so neither does this one.
    return this.decorate({
      organizationId,
      grants: listableGrants(rows),
    });
  };

  findOrganizationBindings = async ({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AuthzAccessBinding[]> => {
    const rows = await this.findGrantRows({ organizationId, where: {} });
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
    const rows = await this.findGrantRows({
      organizationId,
      where: {
        OR: this.userAndGroupGrantWhere({ userId, groupIds }),
      },
    });
    return this.decorate({
      organizationId,
      grants: listableGrants(rows),
    });
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
    const rows = await this.findGrantRows({
      organizationId,
      where: { scopeType, scopeId: { in: [...scopeIds] } },
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
    const rows = await this.findGrantRows({
      organizationId,
      where: { principalType: "GROUP", principalId: groupId },
    });
    return this.decorate({
      organizationId,
      grants: listableGrants(rows),
    });
  };

  /** A key's grants, for keys the caller already loaded from this
   *  organization: decorated, never dropped, as main's credential read. */
  findApiKeyBindings = async ({
    organizationId,
    apiKeyIds,
  }: {
    organizationId: string;
    apiKeyIds: readonly string[];
  }): Promise<AuthzAccessBinding[]> => {
    if (apiKeyIds.length === 0) return [];
    const rows = await this.findGrantRows({
      organizationId,
      where: { principalType: "API_KEY", principalId: { in: [...apiKeyIds] } },
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

    const rows = await this.findGrantRows({
      organizationId,
      where: {
        principalType: "USER",
        scopeType: "TEAM",
        scopeId: { in: [...teamIds] },
      },
    });
    const grants = listableGrants(rows);

    // Full rows here, not the display selects: the member list's shape mirrors
    // a legacy `TeamUser` join and carries the whole user and role. The user
    // read keeps the legacy membership fence (a departed member is not
    // listed); the role read is bounded to the organization.
    const { userIds, roleIds } = teamMemberDecorationIds(grants);
    const [users, roles] = await Promise.all([
      userIds.length > 0
        ? this.database.user.findMany({
            where: {
              id: { in: userIds },
              orgMemberships: { some: { organizationId } },
            },
          })
        : Promise.resolve([]),
      this.findRolesAsCustomRoles({ organizationId, roleIds }),
    ]);
    return teamMemberBindingsFrom({
      teamIds,
      grants,
      users: users as AuthzAccessUser[],
      roles,
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

    const [{ groupIdsByOrg, allGroupIds }, developerOrgIds] = await Promise.all([
      this.groupMembershipsFor({ userId, orgIds }),
      this.developerSeatOrgIds({ userId, orgIds }),
    ]);

    const rows = (
      (await liveGrants(this.database).findMany({
        where: {
          organizationId: { in: [...orgIds] },
          scopeType: { in: [...BINDING_SCOPE_TYPES] },
          AND: [LISTABLE_ROLE_KEY_WHERE],
          OR: this.userAndGroupGrantWhere({
            userId,
            groupIds: allGroupIds,
          }),
        },
        select: GRANT_ROW_SELECT,
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      })) as StoredHeadRow<GrantListRow>[]
    ).map(headRow<GrantListRow>);
    const grants = synthesisGrants({ rows, groupIdsByOrg, developerOrgIds });
    const rolesByOrg = await this.rolesByOrganizationFor(grants);
    return bindingsForSynthesisFrom({ grants, rolesByOrg });
  };

  /** The organizations among `orgIds` where this user holds a Developer seat. */
  private async developerSeatOrgIds({
    userId,
    orgIds,
  }: {
    userId: string;
    orgIds: readonly string[];
  }): Promise<Set<string>> {
    const memberships = (await this.database.organizationUser.findMany({
      where: { userId, organizationId: { in: [...orgIds] }, role: "DEVELOPER" },
      select: { organizationId: true },
    })) as { organizationId: string }[];
    return new Set(memberships.map((membership) => membership.organizationId));
  }

  /** The user's group memberships, resolved per organization so a grant
   *  naming a group can be tied back to "a group this user is in, in the
   *  grant's own organization" - the legacy relation predicate's shape. */
  private async groupMembershipsFor({
    userId,
    orgIds,
  }: {
    userId: string;
    orgIds: readonly string[];
  }): Promise<{
    groupIdsByOrg: Map<string, Set<string>>;
    allGroupIds: string[];
  }> {
    const memberships = (await this.database.groupMembership.findMany({
      where: { userId, group: { organizationId: { in: [...orgIds] } } },
      select: { groupId: true, group: { select: { organizationId: true } } },
    })) as {
      groupId: string;
      group: { organizationId: string };
    }[];
    const groupIdsByOrg = new Map<string, Set<string>>();
    for (const membership of memberships) {
      const orgId = membership.group.organizationId;
      if (!groupIdsByOrg.has(orgId)) groupIdsByOrg.set(orgId, new Set());
      groupIdsByOrg.get(orgId)?.add(membership.groupId);
    }
    const allGroupIds = memberships.map((membership) => membership.groupId);
    return { groupIdsByOrg, allGroupIds };
  }

  /** Role decoration carries the full role for the synthesized member shape.
   *  Per organization: `Role` is a projection with no relations, so the
   *  organization bound is the query's own predicate. */
  private async rolesByOrganizationFor(
    grants: readonly ListableGrant[],
  ): Promise<Map<string, Map<string, AuthzCustomRole>>> {
    const roleIdsByOrg = roleIdsByOrganization(grants);
    const rolesByOrg = new Map<string, Map<string, AuthzCustomRole>>();
    await Promise.all(
      [...roleIdsByOrg.entries()].map(async ([orgId, roleIds]) => {
        const roles = await this.findRolesAsCustomRoles({
          organizationId: orgId,
          roleIds: [...roleIds],
        });
        rolesByOrg.set(orgId, new Map(roles.map((role) => [role.id, role])));
      }),
    );
    return rolesByOrg;
  }

  // An arrow instance property, matching the base class's property-typed
  // abstract member (AuthzListingRepository declares it that way for test
  // mocks).
  findUserCreatedRoles = async ({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AuthzCustomRole[]> => {
    const roles = (
      (await liveRoles(this.database).findMany({
        where: { organizationId, kind: USER_CREATED_ROLE_KIND },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      })) as StoredHeadRow<RoleHeadListRow>[]
    ).map(headRow<RoleHeadListRow>);
    return roles.map(toCustomRoleShape);
  };

  findRolePermissionRows = async ({
    organizationId,
    roleIds,
  }: {
    organizationId: string;
    roleIds: readonly string[];
  }): Promise<{ id: string; name: string; permissions: unknown }[]> => {
    if (roleIds.length === 0) return [];
    return rolePermissionRowsSchema.parse(
      await liveRoles(this.database).findMany({
        where: { id: { in: [...roleIds] }, organizationId },
        select: { id: true, name: true, permissions: true },
      }),
    );
  };

  /** One query shape for every binding listing: the organization, the
   *  listable scope tiers, the listable principal kinds, a roleKey the legacy
   *  vocabulary can carry, and the caller's own predicate on top. Ordered by
   *  business time with the id as the tiebreak - batch-imported facts share
   *  an `occurredAt`, and a listing must not reshuffle between reads. */
  private async findGrantRows({
    organizationId,
    where,
  }: {
    organizationId: string;
    where: Readonly<Record<string, unknown>>;
  }): Promise<GrantListRow[]> {
    return (
      (await liveGrants(this.database).findMany({
        where: {
          organizationId,
          scopeType: { in: [...BINDING_SCOPE_TYPES] },
          principalType: { in: [...BINDING_PRINCIPAL_TYPES] },
          AND: [LISTABLE_ROLE_KEY_WHERE, where],
        },
        select: GRANT_ROW_SELECT,
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      })) as StoredHeadRow<GrantListRow>[]
    ).map(headRow<GrantListRow>);
  }

  /** The `Role` head's rows in the full `CustomRole` column shape the
   *  consumers render. `createdAt` is the role fact's business time, matching
   *  what the binding rows do with `occurredAt`. */
  private async findRolesAsCustomRoles({
    organizationId,
    roleIds,
  }: {
    organizationId: string;
    roleIds: readonly string[];
  }): Promise<AuthzCustomRole[]> {
    if (roleIds.length === 0) return [];
    const roles = (
      (await liveRoles(this.database).findMany({
        where: { id: { in: [...roleIds] }, organizationId },
      })) as StoredHeadRow<RoleHeadListRow>[]
    ).map(headRow<RoleHeadListRow>);
    return roles.map(toCustomRoleShape);
  }

  /** The principal and role decoration for `AccessListingBindingRow`s.
   *  With `shouldDropUndecoratedPrincipals`, a row whose principal no
   *  longer resolves in the organization is dropped (departed member,
   *  foreign group or key); without it, it decorates to null and stays. */
  private async decorate({
    organizationId,
    grants,
    shouldDropUndecoratedPrincipals = false,
  }: {
    organizationId: string;
    grants: readonly ListableGrant[];
    shouldDropUndecoratedPrincipals?: boolean;
  }): Promise<AuthzAccessBinding[]> {
    const decoration = await this.fetchDecoration({
      organizationId,
      ids: collectDecorationIds(grants),
      shouldDropUndecoratedPrincipals,
    });
    return decoratedBindings({ grants, decoration, shouldDropUndecoratedPrincipals });
  }

  private async fetchDecoration({
    organizationId,
    ids,
    shouldDropUndecoratedPrincipals,
  }: {
    organizationId: string;
    ids: DecorationIds;
    shouldDropUndecoratedPrincipals: boolean;
  }): Promise<Decoration> {
    const [users, groups, apiKeys, roles] = await Promise.all([
      ids.user.size > 0
        ? this.database.user.findMany({
            where: this.userDecorationWhere({
              organizationId,
              userIds: [...ids.user],
              requireCurrentMembership: shouldDropUndecoratedPrincipals,
            }),
            select: ACCESS_LISTING_USER_SELECT,
          })
        : Promise.resolve([]),
      ids.group.size > 0
        ? this.database.group.findMany({
            where: { id: { in: [...ids.group] }, organizationId },
            select: ACCESS_LISTING_GROUP_SELECT,
          })
        : Promise.resolve([]),
      ids.apiKey.size > 0
        ? this.database.apiKey.findMany({
            where: { id: { in: [...ids.apiKey] }, organizationId },
            select: ACCESS_LISTING_API_KEY_SELECT,
          })
        : Promise.resolve([]),
      this.findRolesAsCustomRoles({ organizationId, roleIds: [...ids.role] }),
    ]);
    return {
      userById: new Map((users as AuthzAccessUser[]).map((user) => [user.id, user])),
      groupById: new Map((groups as AuthzAccessGroup[]).map((group) => [group.id, group])),
      apiKeyById: new Map((apiKeys as AuthzAccessApiKey[]).map((apiKey) => [apiKey.id, apiKey])),
      roleById: new Map(roles.map((role) => [role.id, role])),
    };
  }

  private userAndGroupGrantWhere({
    userId,
    groupIds,
  }: {
    userId: string;
    groupIds: readonly string[];
  }): Record<string, unknown>[] {
    const principals: Record<string, unknown>[] = [{ principalType: "USER", principalId: userId }];
    if (groupIds.length > 0) {
      principals.push({
        principalType: "GROUP",
        principalId: { in: [...groupIds] },
      });
    }
    return principals;
  }

  private userDecorationWhere({
    organizationId,
    userIds,
    requireCurrentMembership,
  }: {
    organizationId: string;
    userIds: readonly string[];
    requireCurrentMembership: boolean;
  }): Record<string, unknown> {
    const where: Record<string, unknown> = { id: { in: [...userIds] } };
    // Whole-table and scope listings exclude departed members. Per-user reads
    // stay unfenced because the legacy include decorates those rows too.
    if (requireCurrentMembership) {
      where.orgMemberships = { some: { organizationId } };
    }
    return where;
  }
}
const rolePermissionRowsSchema = z.array(
  z.object({ id: z.string(), name: z.string(), permissions: z.unknown() }),
);

/** A head row as the store hands it back: its two timestamps are stored moments. */
type StoredHeadRow<TRow> = Omit<TRow, "occurredAt" | "updatedAt"> & {
  occurredAt: unknown;
  updatedAt: unknown;
};

function storedInstant(value: unknown): Instant {
  if (!(value instanceof Date)) throw new TypeError("stored timestamp is missing");

  return fromDate(value);
}

function headRow<TRow extends { occurredAt: Instant; updatedAt: Instant }>(
  row: StoredHeadRow<TRow>,
): TRow {
  return {
    ...row,
    occurredAt: storedInstant(row.occurredAt),
    updatedAt: storedInstant(row.updatedAt),
  } as TRow;
}
