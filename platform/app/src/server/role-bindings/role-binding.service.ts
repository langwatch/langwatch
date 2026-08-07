import { generate } from "@langwatch/ksuid";
import {
  OrganizationUserRole,
  Prisma,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import {
  getOrganizationRolePermissions,
  getTeamRolePermissions,
  isOrgExclusivePermission,
  type Permission,
} from "~/server/api/rbac";
import { ApiKeyNotFoundError } from "~/server/api-key/errors";
import type { RoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.repository";
import { CUSTOM_ROLE_KIND } from "~/server/role/repositories/role.repository";
import type { RoleService } from "~/server/role/role.service";
import { KSUID_RESOURCES } from "~/utils/constants";
import {
  CustomRoleIdRequiredError,
  CustomRoleNotAssignableError,
  GroupNotInOrganizationError,
  OrgExclusivePermissionScopeError,
  RoleBindingAlreadyExistsError,
  RoleBindingNotFoundError,
  RoleBindingPrincipalInvalidError,
  UserNotInOrganizationError,
} from "./errors";
import { assertNoPersonalTeamScope } from "./personal-team-scope";

/**
 * The partial unique indexes on RoleBinding surface an identical binding as
 * Prisma's P2002; the write paths map it to the deterministic conflict code
 * a provisioning tool can treat as "already done".
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

type ScopeRows = {
  orgs: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string; isPersonal: boolean }>;
  projects: Array<{
    id: string;
    name: string;
    isPersonal: boolean;
    team: { isPersonal: boolean };
  }>;
};

/**
 * The scope rows as the two list surfaces need them: a name per scope, and the
 * set of scopes that are somebody's personal workspace.
 *
 * Either flag is enough to call a project personal. The two are meant to agree,
 * and a reader that insisted on both would offer a half-migrated row as
 * manageable access, which is the one answer that is wrong either way.
 */
function foldScopeRows({ orgs, teams, projects }: ScopeRows): {
  scopeNames: Map<string, string>;
  personalScopeIds: Set<string>;
} {
  const scopeNames = new Map<string, string>();
  for (const scope of [...orgs, ...teams, ...projects]) {
    scopeNames.set(scope.id, scope.name);
  }

  const personalScopeIds = new Set<string>();
  for (const team of teams) {
    if (team.isPersonal) personalScopeIds.add(team.id);
  }
  for (const project of projects) {
    if (project.isPersonal || project.team.isPersonal) {
      personalScopeIds.add(project.id);
    }
  }

  return { scopeNames, personalScopeIds };
}

export class RoleBindingService {
  constructor(
    // TODO: complex queries (listForUser, listForOrg, etc.) should be moved to the repository
    private readonly prisma: PrismaClient,
    private readonly repo: RoleBindingRepository,
    private readonly roleService: RoleService,
  ) {}

  /**
   * Validates the role side of a batch of binding writes: a CUSTOM role
   * needs its id, the custom roles must be assignable in this organization
   * (its own, user-created ones), and a custom role that lists an
   * organization-exclusive permission cannot be bound below organization
   * scope. The read side already refuses to grant such a permission from a
   * team or project binding; accepting the write anyway would store a grant
   * that silently does nothing, which is worse than a refusal, because the
   * admin believes it took effect.
   */
  private async validateBindingRoles({
    organizationId,
    bindings,
  }: {
    organizationId: string;
    bindings: Array<{
      role: TeamUserRole;
      customRoleId?: string | null;
      scopeType: RoleBindingScopeType;
    }>;
  }) {
    for (const b of bindings) {
      if (b.role === TeamUserRole.CUSTOM && !b.customRoleId) {
        throw new CustomRoleIdRequiredError();
      }
    }

    const customBindings = bindings.filter(
      (b): b is typeof b & { customRoleId: string } =>
        b.role === TeamUserRole.CUSTOM && !!b.customRoleId,
    );
    if (customBindings.length === 0) return;

    const customRoleIds = [
      ...new Set(customBindings.map((b) => b.customRoleId)),
    ];
    const assignable = new Set(
      await this.roleService.filterAssignableRoleIds({
        roleIds: customRoleIds,
        organizationId,
      }),
    );
    const notAssignable = customRoleIds.find((id) => !assignable.has(id));
    if (notAssignable) {
      throw new CustomRoleNotAssignableError(notAssignable);
    }

    const belowOrgScope = customBindings.filter(
      (b) => b.scopeType !== RoleBindingScopeType.ORGANIZATION,
    );
    if (belowOrgScope.length === 0) return;

    const roles = await this.prisma.customRole.findMany({
      where: {
        id: { in: [...new Set(belowOrgScope.map((b) => b.customRoleId))] },
        organizationId,
        kind: CUSTOM_ROLE_KIND.CUSTOM,
      },
      select: { id: true, permissions: true },
    });
    const permissionsByRoleId = new Map(
      roles.map((role) => [
        role.id,
        Array.isArray(role.permissions)
          ? role.permissions.filter(
              (permission): permission is string =>
                typeof permission === "string",
            )
          : [],
      ]),
    );
    for (const binding of belowOrgScope) {
      const permissions = permissionsByRoleId.get(binding.customRoleId) ?? [];
      const orgExclusive = permissions.find((permission) =>
        isOrgExclusivePermission(permission as Permission),
      );
      if (orgExclusive) {
        throw new OrgExclusivePermissionScopeError(
          orgExclusive,
          binding.scopeType,
        );
      }
    }
  }

  /** The user id belongs to a member of this organization, or the write stops. */
  private async assertUserInOrganization({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<void> {
    const count = await this.prisma.organizationUser.count({
      where: { organizationId, userId },
    });
    if (count === 0) {
      throw new UserNotInOrganizationError(userId);
    }
  }

  private async validatePrincipalInOrganization({
    organizationId,
    userId,
    groupId,
    apiKeyId,
  }: {
    organizationId: string;
    userId?: string;
    groupId?: string;
    apiKeyId?: string;
  }): Promise<void> {
    if (userId) {
      await this.assertUserInOrganization({ organizationId, userId });
    }
    if (groupId) {
      const group = await this.prisma.group.findFirst({
        where: { id: groupId, organizationId },
        select: { id: true },
      });
      if (!group) {
        throw new GroupNotInOrganizationError(groupId);
      }
    }
    if (apiKeyId) {
      const apiKey = await this.prisma.apiKey.findFirst({
        where: { id: apiKeyId, organizationId },
        select: { id: true },
      });
      if (!apiKey) {
        throw new ApiKeyNotFoundError(apiKeyId);
      }
    }
  }

  /**
   * The display name of every scope these bindings name, and which of those
   * scopes are somebody's personal workspace.
   *
   * A personal workspace is not access an administrator granted or can take
   * away: it is provisioned with the member, holds only them, and every write
   * against it is refused (see `assertNoPersonalTeamScope`). So the two lists
   * an administrator manages access from leave it out, rather than putting a
   * row on the members page for every member of the organization with a control
   * behind it that cannot succeed. What a member may do inside their own
   * workspace follows from their organization role, which those pages already
   * show. `getMyAccessBreakdown` is a member reading their own access rather
   * than a management surface, so it keeps listing it.
   *
   * Scope lookups stay filtered by organization as defense in depth against a
   * stray binding whose scopeId points outside it (historical data, failed
   * migrations), even though the bindings are already filtered by it.
   */
  private async resolveScopes({
    bindings,
    organizationId,
  }: {
    bindings: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>;
    organizationId: string;
  }): Promise<{
    scopeNames: Map<string, string>;
    personalScopeIds: Set<string>;
  }> {
    return foldScopeRows(
      await this.findScopeRows({ bindings, organizationId }),
    );
  }

  /** The scoped rows these bindings point at, one query per scope type. */
  private async findScopeRows({
    bindings,
    organizationId,
  }: {
    bindings: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>;
    organizationId: string;
  }): Promise<ScopeRows> {
    const idsOfType = (scopeType: RoleBindingScopeType) =>
      bindings.filter((b) => b.scopeType === scopeType).map((b) => b.scopeId);

    const orgIds = idsOfType(RoleBindingScopeType.ORGANIZATION);
    const teamIds = idsOfType(RoleBindingScopeType.TEAM);
    const projectIds = idsOfType(RoleBindingScopeType.PROJECT);

    const [orgs, teams, projects] = await Promise.all([
      orgIds.length > 0
        ? this.prisma.organization.findMany({
            where: { id: { in: orgIds } },
            select: { id: true, name: true },
          })
        : [],
      teamIds.length > 0
        ? this.prisma.team.findMany({
            where: { id: { in: teamIds }, organizationId },
            select: { id: true, name: true, isPersonal: true },
          })
        : [],
      projectIds.length > 0
        ? this.prisma.project.findMany({
            where: { id: { in: projectIds }, team: { organizationId } },
            select: {
              id: true,
              name: true,
              isPersonal: true,
              team: { select: { isPersonal: true } },
            },
          })
        : [],
    ]);

    return { orgs, teams, projects };
  }

  async listForUser({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }) {
    const bindings = await this.prisma.roleBinding.findMany({
      where: { organizationId, userId },
      include: {
        customRole: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const { scopeNames, personalScopeIds } = await this.resolveScopes({
      bindings,
      organizationId,
    });

    return bindings
      .filter((b) => !personalScopeIds.has(b.scopeId))
      .map((b) => ({
        id: b.id,
        userId: b.userId,
        role: b.role,
        customRoleId: b.customRoleId,
        customRoleName: b.customRole?.name ?? null,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
        scopeName: scopeNames.get(b.scopeId) ?? null,
        createdAt: b.createdAt,
      }));
  }

  async listForOrg({ organizationId }: { organizationId: string }) {
    const bindings = await this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        OR: [
          {
            userId: { not: null },
            user: { orgMemberships: { some: { organizationId } } },
          },
          { groupId: { not: null }, group: { organizationId } },
          { apiKeyId: { not: null }, apiKey: { organizationId } },
        ],
      },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
        group: { select: { id: true, name: true, scimSource: true } },
        apiKey: { select: { id: true, name: true } },
        customRole: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const { scopeNames, personalScopeIds } = await this.resolveScopes({
      bindings,
      organizationId,
    });
    const manageable = bindings.filter((b) => !personalScopeIds.has(b.scopeId));

    const groupIds = manageable
      .filter((b) => b.groupId != null)
      .map((b) => b.groupId!);
    const groupMemberships =
      groupIds.length > 0
        ? await this.prisma.groupMembership.findMany({
            where: {
              groupId: { in: groupIds },
              group: { organizationId },
              user: { orgMemberships: { some: { organizationId } } },
            },
            select: { groupId: true, userId: true },
          })
        : [];
    const membersByGroup = new Map<string, string[]>();
    for (const m of groupMemberships) {
      if (!membersByGroup.has(m.groupId)) membersByGroup.set(m.groupId, []);
      membersByGroup.get(m.groupId)!.push(m.userId);
    }

    return manageable.map((b) => ({
      id: b.id,
      userId: b.userId,
      userName: b.user?.name ?? null,
      userEmail: b.user?.email ?? null,
      userImage: b.user?.image ?? null,
      groupId: b.groupId,
      groupName: b.group?.name ?? null,
      groupScimSource: b.group?.scimSource ?? null,
      apiKeyId: b.apiKeyId,
      apiKeyName: b.apiKey?.name ?? null,
      role: b.role,
      customRoleId: b.customRoleId,
      customRoleName: b.customRole?.name ?? null,
      scopeType: b.scopeType,
      scopeId: b.scopeId,
      scopeName: scopeNames.get(b.scopeId) ?? null,
      memberUserIds: b.groupId ? (membersByGroup.get(b.groupId) ?? []) : [],
      createdAt: b.createdAt,
    }));
  }

  async getMyAccessBreakdown({
    organizationId,
    userId,
    userName,
    userEmail,
  }: {
    organizationId: string;
    userId: string;
    userName: string | null;
    userEmail: string | null;
  }) {
    const [orgMember, groupMemberships] = await Promise.all([
      this.prisma.organizationUser.findFirst({
        where: { userId, organizationId },
        select: { role: true },
      }),
      this.prisma.groupMembership.findMany({
        where: { userId, group: { organizationId } },
        include: {
          group: {
            select: { id: true, name: true, slug: true, scimSource: true },
          },
        },
      }),
    ]);

    const groupIds = groupMemberships.map((gm) => gm.groupId);

    const allBindings = await this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        OR: [
          { userId },
          ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : []),
        ],
      },
      include: {
        customRole: { select: { id: true, name: true, permissions: true } },
        group: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const orgScopeIds = allBindings
      .filter((b) => b.scopeType === RoleBindingScopeType.ORGANIZATION)
      .map((b) => b.scopeId);
    const teamScopeIds = allBindings
      .filter((b) => b.scopeType === RoleBindingScopeType.TEAM)
      .map((b) => b.scopeId);
    const projectScopeIds = allBindings
      .filter((b) => b.scopeType === RoleBindingScopeType.PROJECT)
      .map((b) => b.scopeId);

    const [orgs, teams, projects] = await Promise.all([
      orgScopeIds.length > 0
        ? this.prisma.organization.findMany({
            where: { id: organizationId },
            select: { id: true, name: true },
          })
        : [],
      teamScopeIds.length > 0
        ? this.prisma.team.findMany({
            where: { id: { in: [...new Set(teamScopeIds)] }, organizationId },
            select: { id: true, name: true },
          })
        : [],
      projectScopeIds.length > 0
        ? this.prisma.project.findMany({
            where: {
              id: { in: [...new Set(projectScopeIds)] },
              team: { organizationId },
            },
            select: { id: true, name: true },
          })
        : [],
    ]);

    const scopeNames = new Map<string, string>();
    for (const o of orgs) scopeNames.set(o.id, o.name);
    for (const t of teams) scopeNames.set(t.id, t.name);
    for (const p of projects) scopeNames.set(p.id, p.name);

    const resolvePermissions = (
      binding: (typeof allBindings)[number],
    ): string[] => {
      if (binding.role === TeamUserRole.CUSTOM && binding.customRole) {
        const perms = binding.customRole.permissions;
        return Array.isArray(perms)
          ? perms.filter((p): p is string => typeof p === "string")
          : [];
      }
      if (binding.scopeType === RoleBindingScopeType.ORGANIZATION) {
        if (binding.role === TeamUserRole.ADMIN) {
          return getOrganizationRolePermissions(OrganizationUserRole.ADMIN);
        }
        if (binding.role === TeamUserRole.MEMBER) {
          return getOrganizationRolePermissions(OrganizationUserRole.MEMBER);
        }
        // VIEWER or CUSTOM (with no resolvable customRole) at the ORG scope:
        // fall back to the minimal EXTERNAL permission set rather than silently
        // elevating to MEMBER. Today nothing writes these bindings, but this
        // prevents accidental promotion if that ever changes.
        return getOrganizationRolePermissions(OrganizationUserRole.EXTERNAL);
      }
      return getTeamRolePermissions(binding.role);
    };

    const toBindingSummary = (b: (typeof allBindings)[number]) => ({
      id: b.id,
      role: b.role as string,
      customRoleName: b.customRole?.name ?? null,
      scopeType: b.scopeType,
      scopeId: b.scopeId,
      scopeName: scopeNames.get(b.scopeId) ?? null,
      permissions: resolvePermissions(b),
    });

    const directBindings = allBindings
      .filter((b) => b.userId === userId)
      .map(toBindingSummary);

    const groupBindingsByGroupId = new Map<
      string,
      (typeof allBindings)[number][]
    >();
    for (const b of allBindings.filter((b) => b.groupId != null)) {
      const gid = b.groupId!;
      if (!groupBindingsByGroupId.has(gid)) groupBindingsByGroupId.set(gid, []);
      groupBindingsByGroupId.get(gid)!.push(b);
    }

    // The router gates this on `organization:view`, so `orgMember` is always
    // present in practice. The fallback is defensive only.
    const orgRole = orgMember?.role ?? OrganizationUserRole.MEMBER;

    return {
      user: {
        id: userId,
        name: userName,
        email: userEmail,
        orgRole: orgRole as string,
        orgRolePermissions: getOrganizationRolePermissions(orgRole),
      },
      groups: groupMemberships.map((gm) => ({
        id: gm.group.id,
        name: gm.group.name,
        slug: gm.group.slug,
        scimSource: gm.group.scimSource,
        bindings: (groupBindingsByGroupId.get(gm.groupId) ?? []).map(
          toBindingSummary,
        ),
      })),
      directBindings,
    };
  }

  async create({
    organizationId,
    userId,
    groupId,
    apiKeyId,
    role,
    customRoleId,
    scopeType,
    scopeId,
  }: {
    organizationId: string;
    userId?: string;
    groupId?: string;
    apiKeyId?: string;
    role: TeamUserRole;
    customRoleId?: string;
    scopeType: RoleBindingScopeType;
    scopeId: string;
  }) {
    const principals = [userId, groupId, apiKeyId].filter(
      (principal) => principal != null && principal !== "",
    );
    if (principals.length !== 1) {
      throw new RoleBindingPrincipalInvalidError();
    }

    await this.repo.validateScopeInOrg({ organizationId, scopeType, scopeId });
    await assertNoPersonalTeamScope({
      client: this.prisma,
      scopes: [{ scopeType, scopeId }],
    });
    await this.validatePrincipalInOrganization({
      organizationId,
      userId,
      groupId,
      apiKeyId,
    });
    await this.validateBindingRoles({
      organizationId,
      bindings: [{ role, customRoleId, scopeType }],
    });

    try {
      return await this.prisma.roleBinding.create({
        data: {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId,
          userId: userId ?? null,
          groupId: groupId ?? null,
          apiKeyId: apiKeyId ?? null,
          role,
          customRoleId:
            role === TeamUserRole.CUSTOM ? (customRoleId ?? null) : null,
          scopeType,
          scopeId,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new RoleBindingAlreadyExistsError({
          meta: { scopeType, scopeId },
        });
      }
      throw error;
    }
  }

  async update({
    organizationId,
    bindingId,
    role,
    customRoleId,
  }: {
    organizationId: string;
    bindingId: string;
    role: TeamUserRole;
    customRoleId?: string;
  }) {
    const binding = await this.prisma.roleBinding.findFirst({
      where: { id: bindingId, organizationId },
    });
    if (!binding) {
      throw new RoleBindingNotFoundError(bindingId);
    }
    await assertNoPersonalTeamScope({ client: this.prisma, scopes: [binding] });
    await this.validateBindingRoles({
      organizationId,
      bindings: [{ role, customRoleId, scopeType: binding.scopeType }],
    });
    return this.prisma.roleBinding.update({
      where: { id: bindingId },
      data: {
        role,
        customRoleId:
          role === TeamUserRole.CUSTOM ? (customRoleId ?? null) : null,
      },
    });
  }

  async delete({
    organizationId,
    bindingId,
  }: {
    organizationId: string;
    bindingId: string;
  }) {
    const binding = await this.prisma.roleBinding.findFirst({
      where: { id: bindingId, organizationId },
    });
    if (!binding) {
      throw new RoleBindingNotFoundError(bindingId);
    }
    await assertNoPersonalTeamScope({ client: this.prisma, scopes: [binding] });
    await this.prisma.roleBinding.delete({ where: { id: bindingId } });
    return { success: true };
  }

  /**
   * Atomically apply a batch of binding deletes + creates for a single user.
   * Used by MemberDetailDialog so a partial failure can never leave the user
   * with some bindings deleted but others not added (or vice versa).
   */
  async applyMemberBindings({
    organizationId,
    userId,
    bindingIdsToDelete,
    bindingsToCreate,
  }: {
    organizationId: string;
    userId: string;
    bindingIdsToDelete: string[];
    bindingsToCreate: Array<{
      role: TeamUserRole;
      customRoleId?: string | null;
      scopeType: RoleBindingScopeType;
      scopeId: string;
    }>;
  }) {
    // Validate scopes and role assignability up front so a bad input fails
    // the whole batch before we open the transaction.
    await this.assertUserInOrganization({ organizationId, userId });
    for (const b of bindingsToCreate) {
      await this.repo.validateScopeInOrg({
        organizationId,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
      });
    }
    await assertNoPersonalTeamScope({
      client: this.prisma,
      scopes: bindingsToCreate,
    });
    await this.validateBindingRoles({
      organizationId,
      bindings: bindingsToCreate,
    });

    return this.prisma.$transaction(async (tx) => {
      if (bindingIdsToDelete.length > 0) {
        const existing = await tx.roleBinding.findMany({
          where: { id: { in: bindingIdsToDelete }, organizationId },
          select: { id: true, scopeType: true, scopeId: true },
        });
        if (existing.length !== bindingIdsToDelete.length) {
          const found = new Set(existing.map((binding) => binding.id));
          const missing =
            bindingIdsToDelete.find((id) => !found.has(id)) ?? "unknown";
          throw new RoleBindingNotFoundError(missing);
        }
        await assertNoPersonalTeamScope({ client: tx, scopes: existing });
        await tx.roleBinding.deleteMany({
          where: { id: { in: bindingIdsToDelete }, organizationId },
        });
      }

      if (bindingsToCreate.length > 0) {
        try {
          await tx.roleBinding.createMany({
            data: bindingsToCreate.map((b) => ({
              id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
              organizationId,
              userId,
              groupId: null,
              role: b.role,
              customRoleId:
                b.role === TeamUserRole.CUSTOM
                  ? (b.customRoleId ?? null)
                  : null,
              scopeType: b.scopeType,
              scopeId: b.scopeId,
            })),
          });
        } catch (error) {
          if (isUniqueConstraintViolation(error)) {
            throw new RoleBindingAlreadyExistsError();
          }
          throw error;
        }
      }

      return { success: true };
    });
  }

  /**
   * Atomically apply a batch of edits to a group: rename, binding
   * additions/removals, and member additions/removals. Wraps everything in a
   * single transaction so the UI never observes a partial save.
   */
  async applyGroupEdits({
    organizationId,
    groupId,
    rename,
    bindingIdsToDelete,
    bindingsToCreate,
    memberUserIdsToAdd,
    memberUserIdsToRemove,
  }: {
    organizationId: string;
    groupId: string;
    rename?: { name: string; slug: string } | null;
    bindingIdsToDelete: string[];
    bindingsToCreate: Array<{
      role: TeamUserRole;
      customRoleId?: string | null;
      scopeType: RoleBindingScopeType;
      scopeId: string;
    }>;
    memberUserIdsToAdd: string[];
    memberUserIdsToRemove: string[];
  }) {
    for (const b of bindingsToCreate) {
      await this.repo.validateScopeInOrg({
        organizationId,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
      });
    }
    await assertNoPersonalTeamScope({
      client: this.prisma,
      scopes: bindingsToCreate,
    });
    await this.validateBindingRoles({
      organizationId,
      bindings: bindingsToCreate,
    });

    return this.prisma.$transaction(async (tx) => {
      const group = await tx.group.findFirst({
        where: { id: groupId, organizationId },
        select: { id: true, scimSource: true },
      });
      if (!group) {
        throw new GroupNotInOrganizationError(groupId);
      }

      if (rename) {
        if (group.scimSource) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "SCIM-managed groups cannot be renamed",
          });
        }
        await tx.group.update({
          where: { id: groupId },
          data: { name: rename.name, slug: rename.slug },
        });
      }

      if (bindingIdsToDelete.length > 0) {
        const existing = await tx.roleBinding.findMany({
          where: {
            id: { in: bindingIdsToDelete },
            organizationId,
            groupId,
          },
          select: { id: true, scopeType: true, scopeId: true },
        });
        if (existing.length !== bindingIdsToDelete.length) {
          const found = new Set(existing.map((binding) => binding.id));
          const missing =
            bindingIdsToDelete.find((id) => !found.has(id)) ?? "unknown";
          throw new RoleBindingNotFoundError(missing);
        }
        await assertNoPersonalTeamScope({ client: tx, scopes: existing });
        await tx.roleBinding.deleteMany({
          where: { id: { in: bindingIdsToDelete }, organizationId, groupId },
        });
      }

      if (bindingsToCreate.length > 0) {
        try {
          await tx.roleBinding.createMany({
            data: bindingsToCreate.map((b) => ({
              id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
              organizationId,
              userId: null,
              groupId,
              role: b.role,
              customRoleId:
                b.role === TeamUserRole.CUSTOM
                  ? (b.customRoleId ?? null)
                  : null,
              scopeType: b.scopeType,
              scopeId: b.scopeId,
            })),
          });
        } catch (error) {
          if (isUniqueConstraintViolation(error)) {
            throw new RoleBindingAlreadyExistsError();
          }
          throw error;
        }
      }

      if (memberUserIdsToRemove.length > 0) {
        if (group.scimSource) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot manually remove members from a SCIM-managed group",
          });
        }
        await tx.groupMembership.deleteMany({
          where: { groupId, userId: { in: memberUserIdsToRemove } },
        });
      }

      if (memberUserIdsToAdd.length > 0) {
        if (group.scimSource) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot manually add members to a SCIM-managed group",
          });
        }
        const orgMembers = await tx.organizationUser.findMany({
          where: {
            organizationId,
            userId: { in: memberUserIdsToAdd },
          },
          select: { userId: true },
        });
        if (orgMembers.length !== memberUserIdsToAdd.length) {
          const found = new Set(orgMembers.map((member) => member.userId));
          const missing =
            memberUserIdsToAdd.find((id) => !found.has(id)) ?? "unknown";
          throw new UserNotInOrganizationError(missing);
        }
        await tx.groupMembership.createMany({
          data: memberUserIdsToAdd.map((userId) => ({ groupId, userId })),
          skipDuplicates: true,
        });
      }

      return { success: true };
    });
  }
}
