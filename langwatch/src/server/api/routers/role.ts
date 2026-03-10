import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { RoleService } from "../../role";
import {
  assertEnterprisePlan,
  ENTERPRISE_FEATURE_ERRORS,
} from "../enterprise";
import {
  checkOrganizationPermission,
  checkTeamPermission,
  hasOrganizationPermission,
} from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const permissionSchema = z.string().regex(/^[a-z]+:[a-z]+$/);

export const roleRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const roleService = new RoleService(ctx.prisma);
      return roleService.getAllRoles(input.organizationId);
    }),

  getById: protectedProcedure
    .input(z.object({ roleId: z.string() }))
    .use(async ({ ctx, input, next }) => {
      // Need to fetch role first to check organization permission
      const roleService = new RoleService(ctx.prisma);
      const role = await roleService.getRoleById(input.roleId);

      // Check if user has permission for this organization
      const hasPermission = await hasOrganizationPermission(
        ctx,
        role.organizationId,
        "organization:view",
      );

      if (!hasPermission) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      ctx.permissionChecked = true;
      return next();
    })
    .query(async ({ ctx, input }) => {
      const roleService = new RoleService(ctx.prisma);
      return await roleService.getRoleById(input.roleId);
    }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().min(1).max(50),
        description: z.string().optional(),
        permissions: z.array(permissionSchema),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      await assertEnterprisePlan({
        organizationId: input.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
      });

      const roleService = new RoleService(ctx.prisma);
      return await roleService.createRole({
        organizationId: input.organizationId,
        name: input.name,
        description: input.description,
        permissions: input.permissions,
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        roleId: z.string(),
        name: z.string().min(1).max(50).optional(),
        description: z.string().optional(),
        permissions: z.array(permissionSchema).optional(),
      }),
    )
    .use(async ({ ctx, input, next }) => {
      // Fetch role to get organizationId for permission check
      const roleService = new RoleService(ctx.prisma);
      const role = await roleService.getRoleById(input.roleId);

      // Check permission before revealing plan details
      const hasPermission = await hasOrganizationPermission(
        ctx,
        role.organizationId,
        "organization:manage",
      );

      if (!hasPermission) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      await assertEnterprisePlan({
        organizationId: role.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
      });

      ctx.permissionChecked = true;
      return next();
    })
    .mutation(async ({ ctx, input }) => {
      const roleService = new RoleService(ctx.prisma);
      return await roleService.updateRole(input.roleId, {
        name: input.name,
        description: input.description,
        permissions: input.permissions,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ roleId: z.string() }))
    .use(async ({ ctx, input, next }) => {
      // Fetch role to get organizationId for permission check
      const roleService = new RoleService(ctx.prisma);
      const role = await roleService.getRoleById(input.roleId);

      // Check if user has permission for this organization
      const hasPermission = await hasOrganizationPermission(
        ctx,
        role.organizationId,
        "organization:manage",
      );

      if (!hasPermission) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      ctx.permissionChecked = true;
      return next();
    })
    .mutation(async ({ ctx, input }) => {
      const roleService = new RoleService(ctx.prisma);
      return await roleService.deleteRole(input.roleId);
    }),

  assignToUser: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        teamId: z.string(),
        customRoleId: z.string(),
      }),
    )
    .use(async ({ ctx, input, next }) => {
      const team = await ctx.prisma.team.findUnique({
        where: { id: input.teamId },
        select: { organizationId: true },
      });

      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
      }

      // Check permission before revealing plan details
      const hasPermission = await hasOrganizationPermission(
        ctx,
        team.organizationId,
        "organization:manage",
      );

      if (!hasPermission) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      await assertEnterprisePlan({
        organizationId: team.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
      });

      ctx.permissionChecked = true;
      return next();
    })
    .mutation(async ({ ctx, input }) => {
      const roleService = new RoleService(ctx.prisma);
      return await roleService.assignRoleToUser(
        input.userId,
        input.teamId,
        input.customRoleId,
      );
    }),

  removeFromUser: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        teamId: z.string(),
        customRoleId: z.string(),
      }),
    )
    .use(checkTeamPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const roleService = new RoleService(ctx.prisma);
      return await roleService.removeRoleFromUser(input.userId, input.teamId);
    }),
});
