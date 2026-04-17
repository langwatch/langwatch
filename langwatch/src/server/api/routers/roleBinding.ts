import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { z } from "zod";
import { checkOrganizationPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { RoleBindingService } from "~/server/role-bindings/role-binding.service";
import { PrismaRoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.prisma.repository";

const scopeTypeSchema = z.nativeEnum(RoleBindingScopeType);
const roleSchema = z.nativeEnum(TeamUserRole);

export const roleBindingRouter = createTRPCRouter({
  /**
   * List all role bindings in an org — used by the Members page to render each
   * member's effective access in the table.
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
   * Same payload as listForOrg but gated at organization:manage so audit data
   * cannot be read via the tRPC API by org members who don't have the audit page.
   */
  listForOrgAudit: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:manage"))
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
      const repo = new PrismaRoleBindingRepository(ctx.prisma);
      const service = new RoleBindingService(ctx.prisma, repo);
      return service.getMyAccessBreakdown({
        organizationId: input.organizationId,
        userId: ctx.session.user.id,
        userName: ctx.session.user.name ?? null,
        userEmail: ctx.session.user.email ?? null,
      });
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
