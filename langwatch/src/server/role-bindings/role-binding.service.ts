import { RoleBindingScopeType, TeamUserRole, type PrismaClient } from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { TRPCError } from "@trpc/server";
import { KSUID_RESOURCES } from "~/utils/constants";
import type { RoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.repository";

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

    const [orgs, teams, projects] = await Promise.all([
      orgIds.length > 0
        ? this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
        : [],
      teamIds.length > 0
        ? this.prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } })
        : [],
      projectIds.length > 0
        ? this.prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })
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
}
