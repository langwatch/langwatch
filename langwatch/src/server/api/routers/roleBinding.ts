import { OrganizationUserRole, RoleBindingScopeType, TeamUserRole, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";
import { checkOrganizationPermission, getOrganizationRolePermissions, getTeamRolePermissions } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const scopeTypeSchema = z.nativeEnum(RoleBindingScopeType);
const roleSchema = z.nativeEnum(TeamUserRole);

export const roleBindingRouter = createTRPCRouter({
  /**
   * List all role bindings in an org — used by the Access Audit page.
   */
  listForOrg: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const bindings = await ctx.prisma.roleBinding.findMany({
        where: { organizationId: input.organizationId },
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
          ? ctx.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
          : [],
        teamIds.length > 0
          ? ctx.prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } })
          : [],
        projectIds.length > 0
          ? ctx.prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })
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
          ? await ctx.prisma.groupMembership.findMany({
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
    }),

  /**
   * List role bindings for a specific user — used by the member detail dialog.
   * More efficient than listForOrg + client-side filter for large orgs.
   */
  listForUser: protectedProcedure
    .input(z.object({ organizationId: z.string(), userId: z.string() }))
    .use(checkOrganizationPermission("organization:manage"))
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = input;
      const bindings = await ctx.prisma.roleBinding.findMany({
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
          ? ctx.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
          : [],
        teamIds.length > 0
          ? ctx.prisma.team.findMany({ where: { id: { in: teamIds }, organizationId }, select: { id: true, name: true } })
          : [],
        projectIds.length > 0
          ? ctx.prisma.project.findMany({ where: { id: { in: projectIds }, team: { organizationId } }, select: { id: true, name: true } })
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
    }),

  /**
   * Returns the current user's full RBAC breakdown:
   * org role, group memberships + their bindings, direct bindings, all with resolved permissions.
   */
  getMyAccessBreakdown: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { organizationId } = input;

      const [orgMember, groupMemberships] = await Promise.all([
        ctx.prisma.organizationUser.findFirst({
          where: { userId, organizationId },
          select: { role: true },
        }),
        ctx.prisma.groupMembership.findMany({
          where: { userId, group: { organizationId } },
          include: { group: { select: { id: true, name: true, slug: true, scimSource: true } } },
        }),
      ]);

      const groupIds = groupMemberships.map((gm) => gm.groupId);

      const allBindings = await ctx.prisma.roleBinding.findMany({
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

      // Resolve scope names
      const orgScopeIds = allBindings.filter((b) => b.scopeType === RoleBindingScopeType.ORGANIZATION).map((b) => b.scopeId);
      const teamScopeIds = allBindings.filter((b) => b.scopeType === RoleBindingScopeType.TEAM).map((b) => b.scopeId);
      const projectScopeIds = allBindings.filter((b) => b.scopeType === RoleBindingScopeType.PROJECT).map((b) => b.scopeId);

      const [orgs, teams, projects] = await Promise.all([
        orgScopeIds.length > 0
          ? ctx.prisma.organization.findMany({ where: { id: organizationId }, select: { id: true, name: true } })
          : [],
        teamScopeIds.length > 0
          ? ctx.prisma.team.findMany({ where: { id: { in: [...new Set(teamScopeIds)] }, organizationId }, select: { id: true, name: true } })
          : [],
        projectScopeIds.length > 0
          ? ctx.prisma.project.findMany({ where: { id: { in: [...new Set(projectScopeIds)] }, team: { organizationId } }, select: { id: true, name: true } })
          : [],
      ]);

      const scopeNames = new Map<string, string>();
      for (const o of orgs) scopeNames.set(o.id, o.name);
      for (const t of teams) scopeNames.set(t.id, t.name);
      for (const p of projects) scopeNames.set(p.id, p.name);

      const resolvePermissions = (binding: (typeof allBindings)[0]): string[] => {
        if (binding.role === TeamUserRole.CUSTOM && binding.customRole) {
          return binding.customRole.permissions as string[];
        }
        if (binding.scopeType === RoleBindingScopeType.ORGANIZATION) {
          const orgRole =
            binding.role === TeamUserRole.ADMIN
              ? OrganizationUserRole.ADMIN
              : OrganizationUserRole.MEMBER;
          return getOrganizationRolePermissions(orgRole);
        }
        return getTeamRolePermissions(binding.role);
      };

      const toBindingSummary = (b: (typeof allBindings)[0]) => ({
        id: b.id,
        role: b.role as string,
        customRoleName: b.customRole?.name ?? null,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
        scopeName: scopeNames.get(b.scopeId) ?? null,
        permissions: resolvePermissions(b),
      });

      const directBindings = allBindings.filter((b) => b.userId === userId).map(toBindingSummary);

      const groupBindingsByGroupId = new Map<string, (typeof allBindings)[0][]>();
      for (const b of allBindings.filter((b) => b.groupId != null)) {
        const gid = b.groupId!;
        if (!groupBindingsByGroupId.has(gid)) groupBindingsByGroupId.set(gid, []);
        groupBindingsByGroupId.get(gid)!.push(b);
      }

      const orgRole = orgMember?.role ?? "MEMBER";

      return {
        user: {
          id: userId,
          name: ctx.session.user.name ?? null,
          email: ctx.session.user.email ?? null,
          orgRole: orgRole as string,
          orgRolePermissions: getOrganizationRolePermissions(orgMember?.role ?? "MEMBER"),
        },
        groups: groupMemberships.map((gm) => ({
          id: gm.group.id,
          name: gm.group.name,
          slug: gm.group.slug,
          scimSource: gm.group.scimSource,
          bindings: (groupBindingsByGroupId.get(gm.groupId) ?? []).map(toBindingSummary),
        })),
        directBindings,
      };
    }),

  /**
   * Create a role binding (user or group) at a given scope.
   */
  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        // Principal — exactly one
        userId: z.string().optional(),
        groupId: z.string().optional(),
        // Role
        role: roleSchema,
        customRoleId: z.string().optional(),
        // Scope
        scopeType: scopeTypeSchema,
        scopeId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      if (!input.userId && !input.groupId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Either userId or groupId must be provided",
        });
      }
      if (input.userId && input.groupId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only one of userId or groupId may be provided",
        });
      }

      // Validate scope resource exists in this org
      await assertScopeInOrg({
        prisma: ctx.prisma,
        organizationId: input.organizationId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      });

      return ctx.prisma.roleBinding.create({
        data: {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: input.organizationId,
          userId: input.userId ?? null,
          groupId: input.groupId ?? null,
          role: input.role,
          customRoleId:
            input.role === TeamUserRole.CUSTOM
              ? (input.customRoleId ?? null)
              : null,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
        },
      });
    }),

  /**
   * Update the role on an existing binding.
   */
  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        bindingId: z.string(),
        role: roleSchema,
        customRoleId: z.string().optional(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const binding = await ctx.prisma.roleBinding.findFirst({
        where: { id: input.bindingId, organizationId: input.organizationId },
      });
      if (!binding) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Binding not found" });
      }
      return ctx.prisma.roleBinding.update({
        where: { id: input.bindingId },
        data: {
          role: input.role,
          customRoleId:
            input.role === TeamUserRole.CUSTOM
              ? (input.customRoleId ?? null)
              : null,
        },
      });
    }),

  /**
   * Delete a role binding by id.
   */
  delete: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        bindingId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const binding = await ctx.prisma.roleBinding.findFirst({
        where: {
          id: input.bindingId,
          organizationId: input.organizationId,
        },
      });
      if (!binding) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Binding not found" });
      }
      await ctx.prisma.roleBinding.delete({ where: { id: input.bindingId } });
      return { success: true };
    }),
});

// ── helpers ──────────────────────────────────────────────────────────────────

export async function assertScopeInOrg({
  prisma,
  organizationId,
  scopeType,
  scopeId,
}: {
  prisma: PrismaClient;
  organizationId: string;
  scopeType: RoleBindingScopeType;
  scopeId: string;
}) {
  if (scopeType === RoleBindingScopeType.ORGANIZATION) {
    if (scopeId !== organizationId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid org scope" });
    }
    return;
  }

  if (scopeType === RoleBindingScopeType.TEAM) {
    const team = await prisma.team.findFirst({
      where: { id: scopeId, organizationId },
    });
    if (!team) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Team not found in this org" });
    }
    return;
  }

  if (scopeType === RoleBindingScopeType.PROJECT) {
    const project = await prisma.project.findFirst({
      where: { id: scopeId },
      include: { team: { select: { organizationId: true } } },
    });
    if (!project || project.team.organizationId !== organizationId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Project not found in this org" });
    }
  }
}
