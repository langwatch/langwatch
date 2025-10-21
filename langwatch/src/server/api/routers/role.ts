import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  checkOrganizationPermission,
  checkTeamPermission,
  hasOrganizationPermission,
} from "../rbac";
import { TRPCError } from "@trpc/server";

const permissionSchema = z.string().regex(/^[a-z]+:[a-z]+$/);

export const roleRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const roles = await ctx.prisma.customRole.findMany({
        where: {
          organizationId: input.organizationId,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return roles.map((role) => ({
        ...role,
        permissions: role.permissions as string[],
      }));
    }),

  getById: protectedProcedure
    .input(z.object({ roleId: z.string() }))
    .use(async ({ ctx, input, next }) => {
      // Need to fetch role first to check organization permission
      const role = await ctx.prisma.customRole.findUnique({
        where: { id: input.roleId },
        select: { organizationId: true },
      });

      if (!role) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Role not found",
        });
      }

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
      const role = await ctx.prisma.customRole.findUnique({
        where: {
          id: input.roleId,
        },
      });

      if (!role) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Role not found" });
      }
      return {
        ...role,
        permissions: role.permissions as string[],
      };
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
      const existing = await ctx.prisma.customRole.findUnique({
        where: {
          organizationId_name: {
            organizationId: input.organizationId,
            name: input.name,
          },
        },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A role with this name already exists",
        });
      }

      const role = await ctx.prisma.customRole.create({
        data: {
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
          permissions: input.permissions,
        },
      });

      return {
        ...role,
        permissions: role.permissions as string[],
      };
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
      const role = await ctx.prisma.customRole.findUnique({
        where: { id: input.roleId },
        select: { organizationId: true },
      });

      if (!role) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Role not found",
        });
      }

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
      const updated = await ctx.prisma.customRole.update({
        where: { id: input.roleId },
        data: {
          name: input.name,
          description: input.description,
          permissions: input.permissions,
        },
      });

      return {
        ...updated,
        permissions: updated.permissions as string[],
      };
    }),

  delete: protectedProcedure
    .input(z.object({ roleId: z.string() }))
    .use(async ({ ctx, input, next }) => {
      // Fetch role to get organizationId and check usage
      const role = await ctx.prisma.customRole.findUnique({
        where: { id: input.roleId },
        include: {
          teamUsers: true,
        },
      });

      if (!role) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Role not found",
        });
      }

      // Check if user has permission for this organization
      const hasPermission = await hasOrganizationPermission(
        ctx,
        role.organizationId,
        "organization:manage",
      );

      if (!hasPermission) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      // Check if role is in use
      if (role.teamUsers.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot delete role that is assigned to ${role.teamUsers.length} user(s)`,
        });
      }

      ctx.permissionChecked = true;
      return next();
    })
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.customRole.delete({
        where: { id: input.roleId },
      });

      return { success: true };
    }),

  assignToUser: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        teamId: z.string(),
        customRoleId: z.string(),
      }),
    )
    .use(checkTeamPermission("team:manage"))
    .mutation(async ({ ctx, input }) => {
      const prisma = ctx.prisma;

      // Validate that the custom role belongs to the team's organization
      // and that the user is actually a member of the team
      const [customRole, team, teamUser] = await Promise.all([
        prisma.customRole.findUnique({
          where: { id: input.customRoleId },
          select: { organizationId: true },
        }),
        prisma.team.findUnique({
          where: { id: input.teamId },
          select: { organizationId: true },
        }),
        prisma.teamUser.findUnique({
          where: {
            userId_teamId: {
              userId: input.userId,
              teamId: input.teamId,
            },
          },
          select: { userId: true },
        }),
      ]);

      // Validate custom role exists
      if (!customRole) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Custom role not found",
        });
      }

      // Validate team exists
      if (!team) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Team not found",
        });
      }

      // Validate organization match
      if (customRole.organizationId !== team.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Custom role does not belong to team's organization",
        });
      }

      // Validate user is a member of the team
      if (!teamUser) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "User is not a member of the specified team",
        });
      }

      // Create the assignment after all validations pass
      const assignment = await prisma.teamUserCustomRole.create({
        data: {
          userId: input.userId,
          teamId: input.teamId,
          customRoleId: input.customRoleId,
        },
      });

      return assignment;
    }),

  removeFromUser: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        teamId: z.string(),
        customRoleId: z.string(),
      }),
    )
    .use(checkTeamPermission("team:manage"))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.teamUserCustomRole.delete({
        where: {
          userId_teamId: {
            userId: input.userId,
            teamId: input.teamId,
          },
        },
      });

      return { success: true };
    }),
});
