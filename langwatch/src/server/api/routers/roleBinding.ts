import { OrganizationUserRole, RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { z } from "zod";
import { checkOrganizationPermission, getOrganizationRolePermissions, getTeamRolePermissions } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { RoleBindingService } from "~/server/role-bindings/role-binding.service";
import { PrismaRoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.prisma.repository";

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
      const repo = new PrismaRoleBindingRepository(ctx.prisma);
      const service = new RoleBindingService(ctx.prisma, repo);
      return service.listForOrg({ organizationId: input.organizationId });
    }),

  /**
   * List role bindings for a specific user — used by the member detail dialog.
   * More efficient than listForOrg + client-side filter for large orgs.
   */
  listForUser: protectedProcedure
    .input(z.object({ organizationId: z.string(), userId: z.string() }))
    .use(checkOrganizationPermission("organization:manage"))
    .query(async ({ ctx, input }) => {
      const repo = new PrismaRoleBindingRepository(ctx.prisma);
      const service = new RoleBindingService(ctx.prisma, repo);
      return service.listForUser({ organizationId: input.organizationId, userId: input.userId });
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
      const repo = new PrismaRoleBindingRepository(ctx.prisma);
      const service = new RoleBindingService(ctx.prisma, repo);
      return service.create({
        organizationId: input.organizationId,
        userId: input.userId,
        groupId: input.groupId,
        role: input.role,
        customRoleId: input.customRoleId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
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
      const repo = new PrismaRoleBindingRepository(ctx.prisma);
      const service = new RoleBindingService(ctx.prisma, repo);
      return service.update({
        organizationId: input.organizationId,
        bindingId: input.bindingId,
        role: input.role,
        customRoleId: input.customRoleId,
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
      const repo = new PrismaRoleBindingRepository(ctx.prisma);
      const service = new RoleBindingService(ctx.prisma, repo);
      return service.delete({
        organizationId: input.organizationId,
        bindingId: input.bindingId,
      });
    }),
});
