/**
 * ADR-092 delivery-plan PR 3 follow-up — the Access surface's reader for a
 * CUT-OVER organization: the same port as
 * `access-listing.prisma.repository.ts`, answered from the ledger's own
 * projection (`Grant` / `Role`) instead of the compat
 * `RoleBinding` / `CustomRole` heads.
 *
 * The translation into the legacy vocabulary is the one the fold itself
 * performs onto the compat rows (`grantFactToCompatBinding`,
 * packages/authz-server): admin→ADMIN, member→MEMBER, viewer→VIEWER,
 * custom:<id>→(`legacyRole` ?? CUSTOM, id). A row the translation cannot
 * express - `lite-member`, a RESOURCE or PLATFORM row, a collective
 * principal - is SKIPPED, never defaulted: those are the dormant head-only
 * facts (delivery-plan decision 13) the legacy pages never carried, and a
 * listing that surfaced them would be a parity break in what people see.
 *
 * Decoration (user names, group names, key names) reads the tables those
 * things actually live in - `User`, `Group`, `ApiKey` are not grants and are
 * never projected - while role names and permissions come from the `Role`
 * head, so a cut-over organization's listing never reads
 * `RoleBinding`/`CustomRole` at all. Role decoration is bounded to the
 * organization: a poisoned grant pointing at another organization's role
 * renders as no role, exactly as the decision reader refuses to honour one.
 *
 * `createdAt` on a listed row is the grant's `occurredAt` - the fact's
 * business time, which an imported grant backdates to the legacy row's
 * `createdAt` - so "since when" reads the same across the heads.
 *
 * Deliberately independent of the legacy implementation, like the decision
 * readers: each has to be readable on its own for a listing parity check to
 * mean anything.
 */
import type {
  CustomRole,
  Prisma,
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
  scopeType: true,
  scopeId: true,
  occurredAt: true,
  updatedAt: true,
} as const satisfies Prisma.GrantSelect;

type GrantListRow = Prisma.GrantGetPayload<{
  select: typeof GRANT_ROW_SELECT;
}>;

/** roleKey → the compat (role, customRoleId) pair, the translation the fold
 *  writes onto the compat head. Null for a key the legacy vocabulary cannot
 *  carry - the caller skips the row. */
function compatRole(row: {
  roleKey: string | null;
  legacyRole: string | null;
}): { role: TeamUserRole; customRoleId: string | null } | null {
  if (row.roleKey === "admin") return { role: "ADMIN", customRoleId: null };
  if (row.roleKey === "member") return { role: "MEMBER", customRoleId: null };
  if (row.roleKey === "viewer") return { role: "VIEWER", customRoleId: null };
  if (row.roleKey?.startsWith("custom:")) {
    return {
      // `roleKey` alone cannot say which built-in role an imported custom
      // binding ALSO carried, and the compat head reproduces it - so must the
      // listing, or a cut-over Access page would show CUSTOM where the page
      // showed ADMIN the day before. The column is a plain string on the
      // projection row; a value the enum cannot carry reads as CUSTOM rather
      // than inventing a role.
      role: teamUserRoleFrom(row.legacyRole) ?? "CUSTOM",
      customRoleId: row.roleKey.slice("custom:".length),
    };
  }
  return null;
}

function teamUserRoleFrom(value: string | null): TeamUserRole | null {
  return value === "ADMIN" ||
    value === "MEMBER" ||
    value === "VIEWER" ||
    value === "CUSTOM"
    ? value
    : null;
}

function isBindingScope(scopeType: string): scopeType is RoleBindingScopeType {
  return (BINDING_SCOPE_TYPES as readonly string[]).includes(scopeType);
}

type ListableGrant = {
  row: GrantListRow;
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
};

function listableGrants(rows: readonly GrantListRow[]): ListableGrant[] {
  const listable: ListableGrant[] = [];
  for (const row of rows) {
    if (!isBindingScope(row.scopeType)) continue;
    const translated = compatRole(row);
    if (!translated) continue;
    listable.push({
      row,
      role: translated.role,
      customRoleId: translated.customRoleId,
      scopeType: row.scopeType,
    });
  }
  return listable;
}

export class GrantsAccessListingRepository implements AccessListingRepository {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

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
      dropUndecoratedPrincipals: true,
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
      dropUndecoratedPrincipals: true,
    });
  }

  async findGroupBindings({
    organizationId,
    groupId,
  }: {
    organizationId: string;
    groupId: string;
  }): Promise<AccessListingBindingRow[]> {
    const rows = await this.findGrantRows({
      organizationId,
      where: { principalType: "GROUP", principalId: groupId },
    });
    return this.decorate({ organizationId, grants: listableGrants(rows) });
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
        grants.flatMap(({ customRoleId }) => (customRoleId ? [customRoleId] : [])),
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

    // The user's group memberships, resolved per organization so a grant
    // naming a group can be tied back to "a group this user is in, in the
    // grant's own organization" - the legacy relation predicate's shape.
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

    const rows = await this.prisma.grant.findMany({
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
    });
    const grants = listableGrants(rows).filter(
      ({ row }) =>
        row.principalType !== "GROUP" ||
        (row.principalId != null &&
          groupIdsByOrg.get(row.organizationId)?.has(row.principalId) === true),
    );

    // Role decoration carries the full role for the synthesized member shape.
    // Per organization: `Role` is a projection with no relations, so the
    // organization bound is the query's own predicate.
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

  async findUserCreatedRoles({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<CustomRole[]> {
    const roles = await this.prisma.role.findMany({
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
    return this.prisma.grant.findMany({
      where: {
        organizationId,
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
    const roles = await this.prisma.role.findMany({
      where: { id: { in: [...roleIds] }, organizationId },
    });
    return roles.map((role) => toCustomRoleShape(role));
  }

  /** The principal and role decoration for `AccessListingBindingRow`s, read
   *  from the tables those things live in. With
   *  `dropUndecoratedPrincipals` the row is dropped when its principal no
   *  longer resolves within the organization - the equivalent of the legacy
   *  whole-table query's relation predicates (a departed member, a foreign
   *  group or key). Without it a missing principal decorates to null and the
   *  row stays, exactly as the legacy per-user reads behave. */
  private async decorate({
    organizationId,
    grants,
    dropUndecoratedPrincipals = false,
  }: {
    organizationId: string;
    grants: readonly ListableGrant[];
    dropUndecoratedPrincipals?: boolean;
  }): Promise<AccessListingBindingRow[]> {
    const ids = { user: new Set<string>(), group: new Set<string>(), apiKey: new Set<string>() };
    const roleIds = new Set<string>();
    for (const grant of grants) {
      if (grant.customRoleId) roleIds.add(grant.customRoleId);
      if (!grant.row.principalId) continue;
      if (grant.row.principalType === "USER") ids.user.add(grant.row.principalId);
      else if (grant.row.principalType === "GROUP") ids.group.add(grant.row.principalId);
      else if (grant.row.principalType === "API_KEY") ids.apiKey.add(grant.row.principalId);
    }

    const [users, groups, apiKeys, roles] = await Promise.all([
      ids.user.size > 0
        ? this.prisma.user.findMany({
            where: {
              id: { in: [...ids.user] },
              // The membership fence only matters where rows are dropped on
              // it; for the per-user reads it is harmless and saves nothing
              // to vary, so it is applied uniformly.
              ...(dropUndecoratedPrincipals
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
      this.findRolesAsCustomRoles({ organizationId, roleIds: [...roleIds] }),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const apiKeyById = new Map(apiKeys.map((apiKey) => [apiKey.id, apiKey]));
    const roleById = new Map(roles.map((role) => [role.id, role]));

    const listed: AccessListingBindingRow[] = [];
    for (const grant of grants) {
      const { row } = grant;
      const user =
        row.principalType === "USER" && row.principalId
          ? (userById.get(row.principalId) ?? null)
          : null;
      const group =
        row.principalType === "GROUP" && row.principalId
          ? (groupById.get(row.principalId) ?? null)
          : null;
      const apiKey =
        row.principalType === "API_KEY" && row.principalId
          ? (apiKeyById.get(row.principalId) ?? null)
          : null;
      if (dropUndecoratedPrincipals && !user && !group && !apiKey) continue;

      const customRole = grant.customRoleId
        ? (roleById.get(grant.customRoleId) ?? null)
        : null;
      listed.push({
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
      });
    }
    return listed;
  }
}

/** A `Role` head row in the `CustomRole` column shape. The two heads share
 *  every column; `createdAt` carries the fact's business time
 *  (`occurredAt`), consistent with what the binding rows report. */
function toCustomRoleShape(role: {
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
