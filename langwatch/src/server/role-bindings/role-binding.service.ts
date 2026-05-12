import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
  type PrismaClient,
} from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { TRPCError } from "@trpc/server";
import { KSUID_RESOURCES } from "~/utils/constants";
import type { RoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.repository";
import {
  getOrganizationRolePermissions,
  getTeamRolePermissions,
} from "~/server/api/rbac";

export class RoleBindingService {
  constructor(
    // TODO: complex queries (listForUser, listForOrg, etc.) should be moved to the repository
    private readonly prisma: PrismaClient,
    private readonly repo: RoleBindingRepository,
  ) {}

  async listForUser({ organizationId, userId }: { organizationId: string; userId: string }) {
    const bindings = await this.prisma.roleBinding.findMany({
      where: { organizationId, userId },
      include: {
        customRole: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const orgIds = bindings.filter((b) => b.scopeType === RoleBindingScopeType.ORGANIZATION).map((b) => b.scopeId);
    const teamIds = bindings.filter((b) => b.scopeType === RoleBindingScopeType.TEAM).map((b) => b.scopeId);
    const projectIds = bindings.filter((b) => b.scopeType === RoleBindingScopeType.PROJECT).map((b) => b.scopeId);

    const [orgs, teams, projects] = await Promise.all([
      orgIds.length > 0
        ? this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
        : [],
      teamIds.length > 0
        ? this.prisma.team.findMany({ where: { id: { in: teamIds }, organizationId }, select: { id: true, name: true } })
        : [],
      projectIds.length > 0
        ? this.prisma.project.findMany({ where: { id: { in: projectIds }, team: { organizationId } }, select: { id: true, name: true } })
        : [],
    ]);

    const scopeNames = new Map<string, string>();
    for (const o of orgs) scopeNames.set(o.id, o.name);
    for (const t of teams) scopeNames.set(t.id, t.name);
    for (const p of projects) scopeNames.set(p.id, p.name);

    return bindings.map((b) => ({
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
      where: { organizationId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        group: { select: { id: true, name: true, scimSource: true } },
        customRole: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const orgIds = bindings
      .filter((b) => b.scopeType === RoleBindingScopeType.ORGANIZATION)
      .map((b) => b.scopeId);
    const teamIds = bindings
      .filter((b) => b.scopeType === RoleBindingScopeType.TEAM)
      .map((b) => b.scopeId);
    const projectIds = bindings
      .filter((b) => b.scopeType === RoleBindingScopeType.PROJECT)
      .map((b) => b.scopeId);

    // Keep scope-name lookups symmetric with listForUser and defense-in-depth
    // against any stray binding whose scopeId points outside the org (historical
    // data, failed migrations). Bindings are already filtered by organizationId.
    const [orgs, teams, projects] = await Promise.all([
      orgIds.length > 0
        ? this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
        : [],
      teamIds.length > 0
        ? this.prisma.team.findMany({ where: { id: { in: teamIds }, organizationId }, select: { id: true, name: true } })
        : [],
      projectIds.length > 0
        ? this.prisma.project.findMany({ where: { id: { in: projectIds }, team: { organizationId } }, select: { id: true, name: true } })
        : [],
    ]);

    const scopeNames = new Map<string, string>();
    for (const o of orgs) scopeNames.set(o.id, o.name);
    for (const t of teams) scopeNames.set(t.id, t.name);
    for (const p of projects) scopeNames.set(p.id, p.name);

    const groupIds = bindings
      .filter((b) => b.groupId != null)
      .map((b) => b.groupId!);
    const groupMemberships =
      groupIds.length > 0
        ? await this.prisma.groupMembership.findMany({
            where: { groupId: { in: groupIds } },
            select: { groupId: true, userId: true },
          })
        : [];
    const membersByGroup = new Map<string, string[]>();
    for (const m of groupMemberships) {
      if (!membersByGroup.has(m.groupId)) membersByGroup.set(m.groupId, []);
      membersByGroup.get(m.groupId)!.push(m.userId);
    }

    return bindings.map((b) => ({
      id: b.id,
      userId: b.userId,
      userName: b.user?.name ?? null,
      userEmail: b.user?.email ?? null,
      groupId: b.groupId,
      groupName: b.group?.name ?? null,
      groupScimSource: b.group?.scimSource ?? null,
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
    role,
    customRoleId,
    scopeType,
    scopeId,
  }: {
    organizationId: string;
    userId?: string;
    groupId?: string;
    role: TeamUserRole;
    customRoleId?: string;
    scopeType: RoleBindingScopeType;
    scopeId: string;
  }) {
    if (!userId && !groupId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Either userId or groupId must be provided",
      });
    }
    if (userId && groupId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Only one of userId or groupId may be provided",
      });
    }

    await this.repo.validateScopeInOrg({ organizationId, scopeType, scopeId });

    return this.prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId,
        userId: userId ?? null,
        groupId: groupId ?? null,
        role,
        customRoleId: role === TeamUserRole.CUSTOM ? (customRoleId ?? null) : null,
        scopeType,
        scopeId,
      },
    });
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
      throw new TRPCError({ code: "NOT_FOUND", message: "Binding not found" });
    }
    return this.prisma.roleBinding.update({
      where: { id: bindingId },
      data: {
        role,
        customRoleId: role === TeamUserRole.CUSTOM ? (customRoleId ?? null) : null,
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
      throw new TRPCError({ code: "NOT_FOUND", message: "Binding not found" });
    }
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
    // Validate scopes up front so a bad input fails the whole batch before
    // we open the transaction.
    for (const b of bindingsToCreate) {
      await this.repo.validateScopeInOrg({
        organizationId,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      if (bindingIdsToDelete.length > 0) {
        const existing = await tx.roleBinding.findMany({
          where: { id: { in: bindingIdsToDelete }, organizationId },
          select: { id: true },
        });
        if (existing.length !== bindingIdsToDelete.length) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "One or more bindings not found",
          });
        }
        await tx.roleBinding.deleteMany({
          where: { id: { in: bindingIdsToDelete }, organizationId },
        });
      }

      if (bindingsToCreate.length > 0) {
        await tx.roleBinding.createMany({
          data: bindingsToCreate.map((b) => ({
            id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
            organizationId,
            userId,
            groupId: null,
            role: b.role,
            customRoleId:
              b.role === TeamUserRole.CUSTOM ? (b.customRoleId ?? null) : null,
            scopeType: b.scopeType,
            scopeId: b.scopeId,
          })),
        });
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

    return this.prisma.$transaction(async (tx) => {
      const group = await tx.group.findFirst({
        where: { id: groupId, organizationId },
        select: { id: true, scimSource: true },
      });
      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
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
          select: { id: true },
        });
        if (existing.length !== bindingIdsToDelete.length) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "One or more bindings not found",
          });
        }
        await tx.roleBinding.deleteMany({
          where: { id: { in: bindingIdsToDelete }, organizationId, groupId },
        });
      }

      if (bindingsToCreate.length > 0) {
        await tx.roleBinding.createMany({
          data: bindingsToCreate.map((b) => ({
            id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
            organizationId,
            userId: null,
            groupId,
            role: b.role,
            customRoleId:
              b.role === TeamUserRole.CUSTOM ? (b.customRoleId ?? null) : null,
            scopeType: b.scopeType,
            scopeId: b.scopeId,
          })),
        });
      }

      if (memberUserIdsToRemove.length > 0) {
        if (group.scimSource) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Cannot manually remove members from a SCIM-managed group",
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
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "All users must belong to the organization before joining a group",
          });
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
