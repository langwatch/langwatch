import { RoleBindingScopeType, TeamUserRole, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { checkOrganizationPermission } from "../rbac";
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

async function assertScopeInOrg({
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
