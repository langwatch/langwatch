/**
 * ADR-092 delivery-plan PR 3 follow-up — the Access surface's legacy reader.
 *
 * These are the queries the settings pages ran inline before the port existed
 * (the former role-binding reader, `TeamService`, the group
 * and API-key repositories), moved here so the per-org fork has a legacy side
 * to delegate to. The WHERE predicates carry over unchanged, with one
 * exception: the group listing gained the organization bound it never had.
 * The row shapes did not - they were consolidated onto one row type and one
 * decoration include, so three reads differ from their inline originals. The
 * API-key read joins where it selected five scalars, `listForOrg`'s role
 * select gained `permissions`, and the synthesis read drops the `group` key
 * it only ever used to filter on.
 *
 * Deliberately independent of `eventing.authz-listing.repository.ts`, for the
 * same reason the decision readers are: the two answer the same questions of
 * different tables, and each has to be readable on its own for a listing
 * parity check to mean anything.
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
} from "@langwatch/authz-contract";
import { AuthzListingRepository } from "../authz-listing.repository";
import type { AuthzDatabase } from "../authz-read.repository";

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
const ACCESS_LISTING_CUSTOM_ROLE_SELECT = {
  id: true,
  name: true,
  permissions: true,
} as const;

const DECORATION_INCLUDE = {
  user: { select: ACCESS_LISTING_USER_SELECT },
  group: { select: ACCESS_LISTING_GROUP_SELECT },
  apiKey: { select: ACCESS_LISTING_API_KEY_SELECT },
  customRole: { select: ACCESS_LISTING_CUSTOM_ROLE_SELECT },
} as const;

type DecoratedRoleBinding = {
  id: string;
  organizationId: string;
  userId: string | null;
  groupId: string | null;
  apiKeyId: string | null;
  role: AuthzAccessBinding["role"];
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
  scopeId: string;
  createdAt: Date;
  user: AuthzAccessUser | null;
  group: AuthzAccessGroup | null;
  apiKey: AuthzAccessApiKey | null;
  customRole: AuthzCustomRole | null;
};

export class PrismaAuthzListingRepository extends AuthzListingRepository {
  static create(database: AuthzDatabase): PrismaAuthzListingRepository {
    return new PrismaAuthzListingRepository(database);
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
    const bindings = (await this.database.roleBinding.findMany({
      where: { organizationId, userId },
      include: DECORATION_INCLUDE,
      orderBy: { createdAt: "asc" },
    })) as DecoratedRoleBinding[];
    return bindings.map((binding) => this.toRow(binding));
  }

  async findOrganizationBindings({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AuthzAccessBinding[]> {
    const bindings = (await this.database.roleBinding.findMany({
      where: {
        organizationId,
        ...this.principalInOrganizationWhere(organizationId),
      },
      include: DECORATION_INCLUDE,
      orderBy: { createdAt: "asc" },
    })) as DecoratedRoleBinding[];
    return bindings.map((binding) => this.toRow(binding));
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
    const bindings = (await this.database.roleBinding.findMany({
      where: {
        organizationId,
        OR: this.userAndGroupPrincipalWhere({ userId, groupIds }),
      },
      include: DECORATION_INCLUDE,
      orderBy: { createdAt: "asc" },
    })) as DecoratedRoleBinding[];
    return bindings.map((binding) => this.toRow(binding));
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
    const bindings = (await this.database.roleBinding.findMany({
      where: {
        organizationId,
        scopeType,
        scopeId: { in: [...scopeIds] },
        ...this.principalInOrganizationWhere(organizationId),
      },
      include: DECORATION_INCLUDE,
    })) as DecoratedRoleBinding[];
    return bindings.map((binding) => this.toRow(binding));
  }

  async findGroupBindings({
    organizationId,
    groupId,
  }: {
    organizationId: string;
    groupId: string;
  }): Promise<AuthzAccessBinding[]> {
    const bindings = (await this.database.roleBinding.findMany({
      where: { organizationId, groupId },
      include: DECORATION_INCLUDE,
    })) as DecoratedRoleBinding[];
    return bindings.map((binding) => this.toRow(binding));
  }

  async findTeamMemberBindings({
    organizationId,
    teamIds,
  }: {
    organizationId: string;
    teamIds: readonly string[];
  }): Promise<Map<string, AuthzTeamMemberBinding[]>> {
    // Pre-seed every requested teamId so the caller can rely on a hit even
    // for teams with no members, and so a single query covers all teams.
    const byTeam = new Map<string, AuthzTeamMemberBinding[]>(
      teamIds.map((teamId) => [teamId, []]),
    );
    if (teamIds.length === 0) return byTeam;

    const bindings = (await this.database.roleBinding.findMany({
      where: {
        organizationId,
        scopeType: "TEAM",
        scopeId: { in: [...teamIds] },
        userId: { not: null },
        user: { orgMemberships: { some: { organizationId } } },
      },
      include: { user: true, customRole: true },
    })) as Array<{
      userId: string | null;
      role: AuthzTeamMemberBinding["role"];
      customRoleId: string | null;
      scopeId: string;
      createdAt: Date;
      updatedAt: Date;
      user: AuthzAccessUser | null;
      customRole: AuthzCustomRole | null;
    }>;

    for (const binding of bindings) {
      // The query filters userId non-null and includes user, but Prisma's
      // types don't narrow — skip defensively rather than assert, so a future
      // change to the where/include can't silently produce undefined fields.
      if (!binding.userId || !binding.user) continue;
      byTeam.get(binding.scopeId)?.push({
        userId: binding.userId,
        role: binding.role,
        customRoleId: binding.customRoleId,
        createdAt: binding.createdAt,
        updatedAt: binding.updatedAt,
        user: binding.user,
        customRole: binding.customRole,
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
    const bindings = (await this.database.roleBinding.findMany({
      where: {
        organizationId: { in: [...orgIds] },
        OR: [{ userId }, { group: { members: { some: { userId } } } }],
        scopeType: { in: ["TEAM", "ORGANIZATION", "PROJECT"] },
      },
      select: {
        organizationId: true,
        scopeType: true,
        scopeId: true,
        role: true,
        customRoleId: true,
        customRole: {
          select: {
            id: true,
            name: true,
            description: true,
            permissions: true,
            organizationId: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        group: { select: { organizationId: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })) as Array<
      AuthzBindingForSynthesis & {
        group: { organizationId: string } | null;
      }
    >;

    return bindings
      .filter(
        (binding) =>
          !binding.group || binding.group.organizationId === binding.organizationId,
      )
      .map(({ group: _group, ...binding }) => binding);
  }

  async findUserCreatedRoles({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AuthzCustomRole[]> {
    return (await this.database.customRole.findMany({
      where: { organizationId, kind: USER_CREATED_ROLE_KIND },
      orderBy: { createdAt: "desc" },
    })) as AuthzCustomRole[];
  }

  /** The relation predicate the whole-table and scope listings carry: a row
   * is listed only while its principal is still of this organization. */
  private principalInOrganizationWhere(organizationId: string): Record<string, unknown> {
    return {
      OR: [
        {
          userId: { not: null },
          user: { orgMemberships: { some: { organizationId } } },
        },
        { groupId: { not: null }, group: { organizationId } },
        { apiKeyId: { not: null }, apiKey: { organizationId } },
      ],
    };
  }

  private userAndGroupPrincipalWhere({
    userId,
    groupIds,
  }: {
    userId: string;
    groupIds: readonly string[];
  }): Array<Record<string, unknown>> {
    const principals: Array<Record<string, unknown>> = [{ userId }];
    if (groupIds.length > 0) {
      principals.push({ groupId: { in: [...groupIds] } });
    }
    return principals;
  }

  private toRow(binding: DecoratedRoleBinding): AuthzAccessBinding {
    return {
      id: binding.id,
      organizationId: binding.organizationId,
      userId: binding.userId,
      groupId: binding.groupId,
      apiKeyId: binding.apiKeyId,
      role: binding.role,
      customRoleId: binding.customRoleId,
      scopeType: binding.scopeType,
      scopeId: binding.scopeId,
      createdAt: binding.createdAt,
      user: binding.user,
      group: binding.group,
      apiKey: binding.apiKey,
      customRole: binding.customRole,
    };
  }
}
