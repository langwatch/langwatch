/**
 * Access surface reader backed by the grants projection (`Grant` / `Role`).
 * It translates only facts expressible by the existing Access API and keeps
 * principal and role decoration tenant-scoped.
 */
import {
  grantFactToCompatBinding,
  grantRowToFact,
  isBindingGrant,
} from "@langwatch/authz-server";
import type {
  CustomRole,
  Prisma,
  RoleBinding,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import type {
  RoleBindingForSynthesis,
  TeamScopedMemberBinding,
} from "~/server/app-layer/role-bindings/repositories/role-binding.repository";
import { CUSTOM_ROLE_KIND } from "../../../role/role-kind";
import type {
  AccessListingBindingRow,
  AccessListingRepository,
} from "./access-listing.repository";
import {
  ACCESS_LISTING_API_KEY_SELECT,
  ACCESS_LISTING_GROUP_SELECT,
  ACCESS_LISTING_USER_SELECT,
} from "./access-listing.repository";
import { liveGrants, liveRoles } from "./live-rows";

/** The three scope tiers a listed binding can carry - RESOURCE rows are the
 *  share tier and PLATFORM rows are dormant facts; neither is a binding the
 *  Access surface lists. */
const BINDING_SCOPE_TYPES = ["ORGANIZATION", "TEAM", "PROJECT"] as const;

/** The three principal kinds the legacy tables could express. Collective
 *  principals (team / organization / project / anyone) are future-head-only
 *  and never listed. */
const BINDING_PRINCIPAL_TYPES = ["USER", "GROUP", "API_KEY"] as const;

/** The roleKey shapes the legacy vocabulary can carry: the three built-ins
 *  and `custom:<id>`. Everything else (`lite-member`, null) is dormant. */
const LISTABLE_ROLE_KEY_WHERE: Prisma.GrantWhereInput = {
  OR: [
    { roleKey: { in: ["admin", "member", "viewer"] } },
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
  source: true,
  scopeType: true,
  scopeId: true,
  token: true,
  permission: true,
  resourceKind: true,
  projectId: true,
  createdByUserId: true,
  expiresAt: true,
  maxViews: true,
  occurredAt: true,
  updatedAt: true,
} as const satisfies Prisma.GrantSelect;

type GrantListRow = Prisma.GrantGetPayload<{
  select: typeof GRANT_ROW_SELECT;
}>;

type ListableGrant = {
  row: GrantListRow;
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
};

function listableGrants(rows: readonly GrantListRow[]): ListableGrant[] {
  const listable: ListableGrant[] = [];
  for (const row of rows) {
    const grant = grantRowToFact(row);
    if (!isBindingGrant(grant)) continue;
    const binding = grantFactToCompatBinding({
      grant,
      organizationId: row.organizationId,
    });
    listable.push({
      row,
      role: binding.role,
      customRoleId: binding.customRoleId,
      scopeType: binding.scopeType,
    });
  }
  return listable;
}

export class GrantsAccessListingRepository implements AccessListingRepository {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  async findBindingRows({
    organizationId,
    where,
  }: {
    organizationId: string;
    where: Prisma.GrantWhereInput;
  }): Promise<RoleBinding[]> {
    const rows = await this.findGrantRows({ organizationId, where });
    return rows.flatMap((row) => {
      const grant = grantRowToFact(row);
      if (!isBindingGrant(grant)) return [];
      return [
        {
          ...grantFactToCompatBinding({ grant, organizationId }),
          createdAt: row.occurredAt,
          updatedAt: row.updatedAt,
        },
      ];
    });
  }

  async findUserBindings({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<AccessListingBindingRow[]> {
    const rows = await this.findGrantRows({
      organizationId,
      where: { principalType: "USER", principalId: userId },
    });
    // The legacy query carries no membership predicate on this read - the
    // caller already scoped the ask to a member - so neither does this one.
    return this.decorate({ organizationId, grants: listableGrants(rows) });
  }

  async findOrganizationBindings({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AccessListingBindingRow[]> {
    const rows = await this.findGrantRows({ organizationId, where: {} });
    return this.decorate({
      organizationId,
      grants: listableGrants(rows),
      shouldDropUndecoratedPrincipals: true,
    });
  }

  async findUserAndGroupBindings({
    organizationId,
    userId,
    groupIds,
  }: {
    organizationId: string;
    userId: string;
    groupIds: readonly string[];
  }): Promise<AccessListingBindingRow[]> {
    const rows = await this.findGrantRows({
      organizationId,
      where: {
        OR: [
          { principalType: "USER", principalId: userId },
          ...(groupIds.length > 0
            ? [
                {
                  principalType: "GROUP" as const,
                  principalId: { in: [...groupIds] },
                },
              ]
            : []),
        ],
      },
    });
    return this.decorate({ organizationId, grants: listableGrants(rows) });
  }

  async findScopeBindings({
    organizationId,
    scopeType,
    scopeIds,
  }: {
    organizationId: string;
    scopeType: RoleBindingScopeType;
    scopeIds: readonly string[];
  }): Promise<AccessListingBindingRow[]> {
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
  }

  async findGroupBindings({
    organizationId,
    groupId,
  }: {
    organizationId: string;
    groupId: string;
  }): Promise<AccessListingBindingRow[]> {
    const bindingsByGroupId = await this.findGroupsBindings({
      organizationId,
      groupIds: [groupId],
    });
    return bindingsByGroupId.get(groupId) ?? [];
  }

  async findGroupsBindings({
    organizationId,
    groupIds,
  }: {
    organizationId: string;
    groupIds: readonly string[];
  }): Promise<Map<string, AccessListingBindingRow[]>> {
    const bindingsByGroupId = new Map<string, AccessListingBindingRow[]>(
      groupIds.map((groupId) => [groupId, []]),
    );
    if (groupIds.length === 0) return bindingsByGroupId;

    const rows = await this.findGrantRows({
      organizationId,
      where: {
        principalType: "GROUP",
        principalId: { in: [...groupIds] },
      },
    });
    const bindings = await this.decorate({
      organizationId,
      grants: listableGrants(rows),
    });
    for (const binding of bindings) {
      if (binding.groupId)
        bindingsByGroupId.get(binding.groupId)?.push(binding);
    }
    return bindingsByGroupId;
  }

  async findApiKeyBindings({
    organizationId,
    apiKeyIds,
  }: {
    organizationId: string;
    apiKeyIds: readonly string[];
  }): Promise<Map<string, AccessListingBindingRow[]>> {
    const byKey = new Map<string, AccessListingBindingRow[]>(
      apiKeyIds.map((apiKeyId) => [apiKeyId, []]),
    );
    if (apiKeyIds.length === 0) return byKey;

    const rows = await this.findGrantRows({
      organizationId,
      where: {
        principalType: "API_KEY",
        principalId: { in: [...apiKeyIds] },
      },
    });
    const listed = await this.decorate({
      organizationId,
      grants: listableGrants(rows),
    });
    for (const row of listed) {
      if (row.apiKeyId) byKey.get(row.apiKeyId)?.push(row);
    }
    return byKey;
  }

  async findTeamMemberBindings({
    organizationId,
    teamIds,
  }: {
    organizationId: string;
    teamIds: readonly string[];
  }): Promise<Map<string, TeamScopedMemberBinding[]>> {
    const byTeam = new Map<string, TeamScopedMemberBinding[]>(
      teamIds.map((teamId) => [teamId, []]),
    );
    if (teamIds.length === 0) return byTeam;

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
    const userIds = [
      ...new Set(
        grants.flatMap(({ row }) => (row.principalId ? [row.principalId] : [])),
      ),
    ];
    const roleIds = [
      ...new Set(
        grants.flatMap(({ customRoleId }) =>
          customRoleId ? [customRoleId] : [],
        ),
      ),
    ];
    const [users, roles] = await Promise.all([
      userIds.length > 0
        ? this.prisma.user.findMany({
            where: {
              id: { in: userIds },
              orgMemberships: { some: { organizationId } },
            },
          })
        : [],
      this.findRolesAsCustomRoles({ organizationId, roleIds }),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const roleById = new Map(roles.map((role) => [role.id, role]));

    for (const grant of grants) {
      const user = grant.row.principalId
        ? userById.get(grant.row.principalId)
        : undefined;
      if (!user) continue;
      byTeam.get(grant.row.scopeId)?.push({
        userId: user.id,
        role: grant.role,
        customRoleId: grant.customRoleId,
        createdAt: grant.row.occurredAt,
        updatedAt: grant.row.updatedAt,
        user,
        customRole: grant.customRoleId
          ? (roleById.get(grant.customRoleId) ?? null)
          : null,
      });
    }
    return byTeam;
  }

  async findBindingsForSynthesis({
    orgIds,
    userId,
  }: {
    orgIds: readonly string[];
    userId: string;
  }): Promise<RoleBindingForSynthesis[]> {
    if (orgIds.length === 0) return [];

    const { groupIdsByOrg, allGroupIds } = await this.groupMembershipsFor({
      userId,
      orgIds,
    });

    const rows = await liveGrants(this.prisma).findMany({
      where: {
        organizationId: { in: [...orgIds] },
        scopeType: { in: [...BINDING_SCOPE_TYPES] },
        AND: [LISTABLE_ROLE_KEY_WHERE],
        OR: [
          { principalType: "USER", principalId: userId },
          ...(allGroupIds.length > 0
            ? [
                {
                  principalType: "GROUP" as const,
                  principalId: { in: allGroupIds },
                },
              ]
            : []),
        ],
      },
      select: GRANT_ROW_SELECT,
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });
    const grants = listableGrants(rows).filter(
      ({ row }) =>
        row.principalType !== "GROUP" ||
        (row.principalId != null &&
          groupIdsByOrg.get(row.organizationId)?.has(row.principalId) === true),
    );

    const rolesByOrg = await this.rolesByOrganizationFor(grants);

    return grants.map(({ row, role, customRoleId, scopeType }) => {
      const customRole = customRoleId
        ? (rolesByOrg.get(row.organizationId)?.get(customRoleId) ?? null)
        : null;
      return {
        organizationId: row.organizationId,
        scopeType,
        scopeId: row.scopeId,
        role,
        customRoleId,
        customRole: customRole
          ? {
              id: customRole.id,
              name: customRole.name,
              description: customRole.description,
              permissions: customRole.permissions,
              organizationId: customRole.organizationId,
              createdAt: customRole.createdAt,
              updatedAt: customRole.updatedAt,
            }
          : null,
      };
    });
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
    const memberships = await this.prisma.groupMembership.findMany({
      where: { userId, group: { organizationId: { in: [...orgIds] } } },
      select: { groupId: true, group: { select: { organizationId: true } } },
    });
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
  ): Promise<Map<string, Map<string, CustomRole>>> {
    const roleIdsByOrg = new Map<string, Set<string>>();
    for (const { row, customRoleId } of grants) {
      if (!customRoleId) continue;
      if (!roleIdsByOrg.has(row.organizationId)) {
        roleIdsByOrg.set(row.organizationId, new Set());
      }
      roleIdsByOrg.get(row.organizationId)?.add(customRoleId);
    }
    const rolesByOrg = new Map<string, Map<string, CustomRole>>();
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

  async findUserCreatedRoles({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<CustomRole[]> {
    const roles = await liveRoles(this.prisma).findMany({
      where: { organizationId, kind: CUSTOM_ROLE_KIND.CUSTOM },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    });
    return roles.map((role) => toCustomRoleShape(role));
  }

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
    where: Prisma.GrantWhereInput;
  }): Promise<GrantListRow[]> {
    return liveGrants(this.prisma).findMany({
      where: {
        organizationId,
        principalId: { not: null },
        scopeType: { in: [...BINDING_SCOPE_TYPES] },
        principalType: { in: [...BINDING_PRINCIPAL_TYPES] },
        AND: [LISTABLE_ROLE_KEY_WHERE, where],
      },
      select: GRANT_ROW_SELECT,
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });
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
  }): Promise<CustomRole[]> {
    if (roleIds.length === 0) return [];
    const roles = await liveRoles(this.prisma).findMany({
      where: { id: { in: [...roleIds] }, organizationId },
    });
    return roles.map((role) => toCustomRoleShape(role));
  }

  /** The principal and role decoration for `AccessListingBindingRow`s, read
   *  from the tables those things live in. With
   *  `shouldDropUndecoratedPrincipals` the row is dropped when its principal no
   *  longer resolves within the organization - the equivalent of the legacy
   *  whole-table query's relation predicates (a departed member, a foreign
   *  group or key). Without it a missing principal decorates to null and the
   *  row stays, exactly as the legacy per-user reads behave. */
  private async decorate({
    organizationId,
    grants,
    shouldDropUndecoratedPrincipals = false,
  }: {
    organizationId: string;
    grants: readonly ListableGrant[];
    shouldDropUndecoratedPrincipals?: boolean;
  }): Promise<AccessListingBindingRow[]> {
    const decoration = await this.fetchDecoration({
      organizationId,
      ids: collectDecorationIds(grants),
      shouldDropUndecoratedPrincipals,
    });
    const listed: AccessListingBindingRow[] = [];
    for (const grant of grants) {
      const row = toListedRow({
        grant,
        decoration,
        shouldDropUndecoratedPrincipals,
      });
      if (row) listed.push(row);
    }
    return listed;
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
        ? this.prisma.user.findMany({
            where: {
              id: { in: [...ids.user] },
              // The membership fence applies only on the drop paths — the
              // whole-table and scope listings, where the legacy queries
              // exclude departed members via their relation predicates. The
              // per-user reads stay unfenced on purpose: legacy decorates a
              // departed member's own rows via an unfenced include, and the
              // ids there always come from the caller, never from discovery.
              ...(shouldDropUndecoratedPrincipals
                ? { orgMemberships: { some: { organizationId } } }
                : {}),
            },
            select: ACCESS_LISTING_USER_SELECT,
          })
        : [],
      ids.group.size > 0
        ? this.prisma.group.findMany({
            where: { id: { in: [...ids.group] }, organizationId },
            select: ACCESS_LISTING_GROUP_SELECT,
          })
        : [],
      ids.apiKey.size > 0
        ? this.prisma.apiKey.findMany({
            where: { id: { in: [...ids.apiKey] }, organizationId },
            select: ACCESS_LISTING_API_KEY_SELECT,
          })
        : [],
      this.findRolesAsCustomRoles({ organizationId, roleIds: [...ids.role] }),
    ]);
    return {
      userById: new Map(users.map((user) => [user.id, user])),
      groupById: new Map(groups.map((group) => [group.id, group])),
      apiKeyById: new Map(apiKeys.map((apiKey) => [apiKey.id, apiKey])),
      roleById: new Map(roles.map((role) => [role.id, role])),
    };
  }
}

type DecorationIds = {
  user: Set<string>;
  group: Set<string>;
  apiKey: Set<string>;
  role: Set<string>;
};

type Decoration = {
  userById: Map<string, NonNullable<AccessListingBindingRow["user"]>>;
  groupById: Map<string, NonNullable<AccessListingBindingRow["group"]>>;
  apiKeyById: Map<string, NonNullable<AccessListingBindingRow["apiKey"]>>;
  roleById: Map<string, CustomRole>;
};

function collectDecorationIds(grants: readonly ListableGrant[]): DecorationIds {
  const ids: DecorationIds = {
    user: new Set(),
    group: new Set(),
    apiKey: new Set(),
    role: new Set(),
  };
  const byPrincipalType: Partial<Record<string, Set<string>>> = {
    USER: ids.user,
    GROUP: ids.group,
    API_KEY: ids.apiKey,
  };
  for (const grant of grants) {
    if (grant.customRoleId) ids.role.add(grant.customRoleId);
    if (grant.row.principalId) {
      byPrincipalType[grant.row.principalType]?.add(grant.row.principalId);
    }
  }
  return ids;
}

function principalOf({
  row,
  decoration,
}: {
  row: ListableGrant["row"];
  decoration: Decoration;
}): Pick<AccessListingBindingRow, "user" | "group" | "apiKey"> {
  const { principalId } = row;
  if (!principalId) return { user: null, group: null, apiKey: null };
  return {
    user:
      row.principalType === "USER"
        ? (decoration.userById.get(principalId) ?? null)
        : null,
    group:
      row.principalType === "GROUP"
        ? (decoration.groupById.get(principalId) ?? null)
        : null,
    apiKey:
      row.principalType === "API_KEY"
        ? (decoration.apiKeyById.get(principalId) ?? null)
        : null,
  };
}

function toListedRow({
  grant,
  decoration,
  shouldDropUndecoratedPrincipals,
}: {
  grant: ListableGrant;
  decoration: Decoration;
  shouldDropUndecoratedPrincipals: boolean;
}): AccessListingBindingRow | null {
  const { row } = grant;
  const { user, group, apiKey } = principalOf({ row, decoration });
  if (shouldDropUndecoratedPrincipals && !user && !group && !apiKey)
    return null;

  const customRole = grant.customRoleId
    ? (decoration.roleById.get(grant.customRoleId) ?? null)
    : null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.principalType === "USER" ? row.principalId : null,
    groupId: row.principalType === "GROUP" ? row.principalId : null,
    apiKeyId: row.principalType === "API_KEY" ? row.principalId : null,
    role: grant.role,
    customRoleId: grant.customRoleId,
    scopeType: grant.scopeType,
    scopeId: row.scopeId,
    createdAt: row.occurredAt,
    updatedAt: row.updatedAt,
    user,
    group,
    apiKey,
    customRole: customRole
      ? {
          id: customRole.id,
          name: customRole.name,
          permissions: customRole.permissions,
        }
      : null,
  };
}

/** A `Role` head row in the `CustomRole` column shape. The two heads share
 *  every column; `createdAt` carries the fact's business time
 *  (`occurredAt`), consistent with what the binding rows report. */
export function toCustomRoleShape(role: {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  permissions: Prisma.JsonValue;
  kind: string;
  occurredAt: Date;
  updatedAt: Date;
}): CustomRole {
  return {
    id: role.id,
    organizationId: role.organizationId,
    name: role.name,
    description: role.description,
    permissions: role.permissions,
    kind: role.kind,
    createdAt: role.occurredAt,
    updatedAt: role.updatedAt,
  };
}
