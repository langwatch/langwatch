/**
 * ADR-092 delivery-plan PR 3 follow-up — the Access surface's reader for a
 * CUT-OVER organization: the same port as
 * `prisma.authz-listing.repository.ts`, answered from the ledger's own
 * projection (`Grant` / `Role`) instead of the compat
 * `RoleBinding` / `CustomRole` heads.
 *
 * The translation into the legacy vocabulary is the one the fold itself
 * performs onto the compat rows (`grantFactToCompatBinding`,
 * the AuthZ contract): admin→ADMIN, member→MEMBER, viewer→VIEWER,
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
  AuthzAccessApiKey,
  AuthzAccessBinding,
  AuthzAccessGroup,
  AuthzAccessUser,
  AuthzBindingForSynthesis,
  AuthzCustomRole,
  AuthzTeamMemberBinding,
  RoleBindingScopeType,
  TeamUserRole,
} from "@langwatch/authz-contract";
import { AuthzListingRepository } from "../authz-listing.repository";
import type { AuthzDatabase } from "../authz-read.repository";
import { liveGrants, liveRoles } from "./eventing.authz-live-rows.mapper";

const USER_CREATED_ROLE_KIND = "custom" as const;
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
const LISTABLE_ROLE_KEY_WHERE = {
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
} as const;

type GrantListRow = {
  id: string;
  organizationId: string;
  principalType: string;
  principalId: string | null;
  roleKey: string | null;
  legacyRole: string | null;
  scopeType: string;
  scopeId: string;
  occurredAt: Date;
  updatedAt: Date;
};

type ListableGrant = {
  row: GrantListRow;
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
};

export class EventingAuthzListingRepository extends AuthzListingRepository {
  static create(database: AuthzDatabase): EventingAuthzListingRepository {
    return new EventingAuthzListingRepository(database);
  }

  private constructor(private readonly database: AuthzDatabase) {
    super();
  }

  async findUserBindings({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<AuthzAccessBinding[]> {
    const rows = await this.findGrantRows({
      organizationId,
      where: { principalType: "USER", principalId: userId },
    });
    // The legacy query carries no membership predicate on this read - the
    // caller already scoped the ask to a member - so neither does this one.
    return this.decorate({
      organizationId,
      grants: this.listableGrants(rows),
    });
  }

  async findOrganizationBindings({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AuthzAccessBinding[]> {
    const rows = await this.findGrantRows({ organizationId, where: {} });
    return this.decorate({
      organizationId,
      grants: this.listableGrants(rows),
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
  }): Promise<AuthzAccessBinding[]> {
    const rows = await this.findGrantRows({
      organizationId,
      where: {
        OR: this.userAndGroupGrantWhere({ userId, groupIds }),
      },
    });
    return this.decorate({
      organizationId,
      grants: this.listableGrants(rows),
    });
  }

  async findScopeBindings({
    organizationId,
    scopeType,
    scopeIds,
  }: {
    organizationId: string;
    scopeType: RoleBindingScopeType;
    scopeIds: readonly string[];
  }): Promise<AuthzAccessBinding[]> {
    if (scopeIds.length === 0) return [];
    const rows = await this.findGrantRows({
      organizationId,
      where: { scopeType, scopeId: { in: [...scopeIds] } },
    });
    return this.decorate({
      organizationId,
      grants: this.listableGrants(rows),
      shouldDropUndecoratedPrincipals: true,
    });
  }

  async findGroupBindings({
    organizationId,
    groupId,
  }: {
    organizationId: string;
    groupId: string;
  }): Promise<AuthzAccessBinding[]> {
    const rows = await this.findGrantRows({
      organizationId,
      where: { principalType: "GROUP", principalId: groupId },
    });
    return this.decorate({
      organizationId,
      grants: this.listableGrants(rows),
    });
  }

  async findTeamMemberBindings({
    organizationId,
    teamIds,
  }: {
    organizationId: string;
    teamIds: readonly string[];
  }): Promise<Map<string, AuthzTeamMemberBinding[]>> {
    const byTeam = new Map<string, AuthzTeamMemberBinding[]>(
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
    const grants = this.listableGrants(rows);

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
        ? this.database.user.findMany({
            where: {
              id: { in: userIds },
              orgMemberships: { some: { organizationId } },
            },
          })
        : Promise.resolve([]),
      this.findRolesAsCustomRoles({ organizationId, roleIds }),
    ]);
    const typedUsers = users as AuthzAccessUser[];
    const userById = new Map(typedUsers.map((user) => [user.id, user]));
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
  }): Promise<AuthzBindingForSynthesis[]> {
    if (orgIds.length === 0) return [];

    const { groupIdsByOrg, allGroupIds } = await this.groupMembershipsFor({
      userId,
      orgIds,
    });

    const rows = (await liveGrants(this.database).findMany({
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
    })) as GrantListRow[];
    const grants = this.listableGrants(rows).filter(
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
    const memberships = (await this.database.groupMembership.findMany({
      where: { userId, group: { organizationId: { in: [...orgIds] } } },
      select: { groupId: true, group: { select: { organizationId: true } } },
    })) as Array<{
      groupId: string;
      group: { organizationId: string };
    }>;
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
    const roleIdsByOrg = new Map<string, Set<string>>();
    for (const { row, customRoleId } of grants) {
      if (!customRoleId) continue;
      if (!roleIdsByOrg.has(row.organizationId)) {
        roleIdsByOrg.set(row.organizationId, new Set());
      }
      roleIdsByOrg.get(row.organizationId)?.add(customRoleId);
    }
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

  async findUserCreatedRoles({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AuthzCustomRole[]> {
    const roles = (await liveRoles(this.database).findMany({
      where: { organizationId, kind: USER_CREATED_ROLE_KIND },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    })) as RoleHeadRow[];
    return roles.map((role) => this.toCustomRoleShape(role));
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
    where: Readonly<Record<string, unknown>>;
  }): Promise<GrantListRow[]> {
    return (await liveGrants(this.database).findMany({
      where: {
        organizationId,
        scopeType: { in: [...BINDING_SCOPE_TYPES] },
        principalType: { in: [...BINDING_PRINCIPAL_TYPES] },
        AND: [LISTABLE_ROLE_KEY_WHERE, where],
      },
      select: GRANT_ROW_SELECT,
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    })) as GrantListRow[];
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
    const roles = (await liveRoles(this.database).findMany({
      where: { id: { in: [...roleIds] }, organizationId },
    })) as RoleHeadRow[];
    return roles.map((role) => this.toCustomRoleShape(role));
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
  }): Promise<AuthzAccessBinding[]> {
    const decoration = await this.fetchDecoration({
      organizationId,
      ids: this.collectDecorationIds(grants),
      shouldDropUndecoratedPrincipals,
    });
    const listed: AuthzAccessBinding[] = [];
    for (const grant of grants) {
      const row = this.toListedRow({
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
      userById: new Map(
        (users as AuthzAccessUser[]).map((user) => [user.id, user]),
      ),
      groupById: new Map(
        (groups as AuthzAccessGroup[]).map((group) => [group.id, group]),
      ),
      apiKeyById: new Map(
        (apiKeys as AuthzAccessApiKey[]).map((apiKey) => [apiKey.id, apiKey]),
      ),
      roleById: new Map(roles.map((role) => [role.id, role])),
    };
  }

  private userAndGroupGrantWhere({
    userId,
    groupIds,
  }: {
    userId: string;
    groupIds: readonly string[];
  }): Array<Record<string, unknown>> {
    const principals: Array<Record<string, unknown>> = [
      { principalType: "USER", principalId: userId },
    ];
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

  /** roleKey → the compat pair the fold writes onto the legacy head. */
  private compatRole(row: {
    roleKey: string | null;
    legacyRole: string | null;
  }): { role: TeamUserRole; customRoleId: string | null } | null {
    if (row.roleKey === "admin") return { role: "ADMIN", customRoleId: null };
    if (row.roleKey === "member") {
      return { role: "MEMBER", customRoleId: null };
    }
    if (row.roleKey === "viewer") {
      return { role: "VIEWER", customRoleId: null };
    }
    if (row.roleKey?.startsWith("custom:")) {
      return {
        role: this.teamUserRoleFrom(row.legacyRole) ?? "CUSTOM",
        customRoleId: row.roleKey.slice("custom:".length),
      };
    }
    return null;
  }

  private teamUserRoleFrom(value: string | null): TeamUserRole | null {
    return value === "ADMIN" ||
      value === "MEMBER" ||
      value === "VIEWER" ||
      value === "CUSTOM"
      ? value
      : null;
  }

  private isBindingScope(scopeType: string): scopeType is RoleBindingScopeType {
    return (BINDING_SCOPE_TYPES as readonly string[]).includes(scopeType);
  }

  private isBindingPrincipal(principalType: string): boolean {
    return (BINDING_PRINCIPAL_TYPES as readonly string[]).includes(
      principalType,
    );
  }

  private listableGrants(rows: readonly GrantListRow[]): ListableGrant[] {
    const listable: ListableGrant[] = [];
    for (const row of rows) {
      if (!this.isBindingScope(row.scopeType)) continue;
      if (!this.isBindingPrincipal(row.principalType)) continue;
      const translated = this.compatRole(row);
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

  private collectDecorationIds(
    grants: readonly ListableGrant[],
  ): DecorationIds {
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

  private principalOf({
    row,
    decoration,
  }: {
    row: ListableGrant["row"];
    decoration: Decoration;
  }): Pick<AuthzAccessBinding, "user" | "group" | "apiKey"> {
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

  private toListedRow({
    grant,
    decoration,
    shouldDropUndecoratedPrincipals,
  }: {
    grant: ListableGrant;
    decoration: Decoration;
    shouldDropUndecoratedPrincipals: boolean;
  }): AuthzAccessBinding | null {
    const { row } = grant;
    const { user, group, apiKey } = this.principalOf({ row, decoration });
    if (shouldDropUndecoratedPrincipals && !user && !group && !apiKey) {
      return null;
    }
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
      user,
      group,
      apiKey,
      customRole,
    };
  }

  private toCustomRoleShape(role: RoleHeadRow): AuthzCustomRole {
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
}

type DecorationIds = {
  user: Set<string>;
  group: Set<string>;
  apiKey: Set<string>;
  role: Set<string>;
};

type Decoration = {
  userById: Map<string, AuthzAccessUser>;
  groupById: Map<string, AuthzAccessGroup>;
  apiKeyById: Map<string, AuthzAccessApiKey>;
  roleById: Map<string, AuthzCustomRole>;
};

/** A `Role` head row in the `CustomRole` column shape. The two heads share
 *  every column; `createdAt` carries the fact's business time
 *  (`occurredAt`), consistent with what the binding rows report. */
type RoleHeadRow = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  permissions: unknown;
  kind: string;
  occurredAt: Date;
  updatedAt: Date;
};
