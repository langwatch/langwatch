import { TeamUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  assertEnterprisePlan,
  ENTERPRISE_FEATURE_ERRORS,
} from "../enterprise";
import { checkOrganizationPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { resolveHighestRole } from "../../scim/scim-role-resolver";
import { ScimGroupService } from "../../scim/scim-group.service";
import { slugify } from "~/utils/slugify";

/**
 * tRPC router for managing SCIM group-to-team mappings.
 *
 * All endpoints require Enterprise plan and organization:manage permission.
 * Admins use these endpoints to link SCIM-pushed groups to LangWatch teams
 * with specific roles.
 */
export const scimGroupMappingRouter = createTRPCRouter({
  /**
   * Lists all ScimGroupMapping records for an organization, including
   * team name, project name, member count, and mapped status.
   */
  listAll: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:manage"))
    .query(async ({ ctx, input }) => {
      await assertEnterprisePlan({
        organizationId: input.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
      });

      const mappings = await ctx.prisma.scimGroupMapping.findMany({
        where: { organizationId: input.organizationId },
        include: {
          team: {
            include: {
              projects: {
                where: { archivedAt: null },
                select: { name: true },
              },
            },
          },
          customRole: { select: { id: true, name: true } },
          _count: { select: { memberships: true } },
        },
      });

      return mappings.map((m) => ({
        id: m.id,
        externalGroupId: m.externalGroupId,
        externalGroupName: m.externalGroupName,
        teamId: m.teamId,
        teamName: m.team?.name ?? null,
        projectNames:
          m.team?.projects?.length && m.team.projects.length > 0
            ? m.team.projects.map((p) => p.name)
            : null,
        projectName:
          m.team?.projects?.length && m.team.projects.length > 0
            ? m.team.projects[0]?.name ?? null
            : null,
        role: m.role,
        customRoleId: m.customRoleId,
        customRoleName: m.customRole?.name ?? null,
        memberCount: m._count.memberships,
        mapped: m.teamId !== null && m.role !== null,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      }));
    }),

  /**
   * Lists only unmapped ScimGroupMapping records (teamId IS null).
   */
  listUnmapped: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:manage"))
    .query(async ({ ctx, input }) => {
      await assertEnterprisePlan({
        organizationId: input.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
      });

      const mappings = await ctx.prisma.scimGroupMapping.findMany({
        where: {
          organizationId: input.organizationId,
          teamId: null,
        },
        select: {
          id: true,
          externalGroupId: true,
          externalGroupName: true,
          createdAt: true,
        },
      });

      return mappings;
    }),

  /**
   * Maps an unmapped SCIM group to an existing team with a role.
   */
  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        mappingId: z.string(),
        teamId: z.string(),
        role: z.nativeEnum(TeamUserRole),
        customRoleId: z.string().optional(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      await assertEnterprisePlan({
        organizationId: input.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
      });

      // Validate mapping exists in this org
      const mapping = await ctx.prisma.scimGroupMapping.findFirst({
        where: { id: input.mappingId, organizationId: input.organizationId },
      });
      if (!mapping) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Mapping not found" });
      }

      // Validate team exists in same org
      const team = await ctx.prisma.team.findFirst({
        where: { id: input.teamId, organizationId: input.organizationId },
      });
      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found in this organization" });
      }

      // Validate custom role if CUSTOM
      if (input.role === TeamUserRole.CUSTOM) {
        if (!input.customRoleId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "customRoleId is required when role is CUSTOM",
          });
        }
        const customRole = await ctx.prisma.customRole.findFirst({
          where: { id: input.customRoleId, organizationId: input.organizationId },
        });
        if (!customRole) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Custom role not found in this organization",
          });
        }
      }

      return ctx.prisma.scimGroupMapping.update({
        where: { id: input.mappingId },
        data: {
          teamId: input.teamId,
          role: input.role,
          customRoleId: input.role === TeamUserRole.CUSTOM ? input.customRoleId : null,
        },
      });
    }),

  /**
   * Creates a new team under a project, then maps the SCIM group to it.
   */
  createWithNewTeam: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        mappingId: z.string(),
        projectId: z.string(),
        teamName: z.string().min(1),
        role: z.nativeEnum(TeamUserRole),
        customRoleId: z.string().optional(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      await assertEnterprisePlan({
        organizationId: input.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
      });

      // Validate mapping exists in this org
      const mapping = await ctx.prisma.scimGroupMapping.findFirst({
        where: { id: input.mappingId, organizationId: input.organizationId },
      });
      if (!mapping) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Mapping not found" });
      }

      // Validate project exists in same org (via team)
      const project = await ctx.prisma.project.findFirst({
        where: { id: input.projectId },
        include: { team: { select: { organizationId: true } } },
      });
      if (!project || project.team.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found in this organization",
        });
      }

      // Create new team
      const teamNanoId = nanoid();
      const teamId = `team_${teamNanoId}`;
      const teamSlug =
        slugify(input.teamName, { lower: true, strict: true }) +
        "-" +
        teamNanoId.substring(0, 6);

      return ctx.prisma.$transaction(async (tx) => {
        const team = await tx.team.create({
          data: {
            id: teamId,
            name: input.teamName,
            slug: teamSlug,
            organizationId: input.organizationId,
          },
        });

        const updatedMapping = await tx.scimGroupMapping.update({
          where: { id: input.mappingId },
          data: {
            teamId: team.id,
            role: input.role,
            customRoleId: input.role === TeamUserRole.CUSTOM ? input.customRoleId : null,
          },
        });

        return { mapping: updatedMapping, team };
      });
    }),

  /**
   * Updates role on a mapping and re-syncs all TeamUser records for current members.
   */
  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        mappingId: z.string(),
        role: z.nativeEnum(TeamUserRole).optional(),
        customRoleId: z.string().optional(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      await assertEnterprisePlan({
        organizationId: input.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
      });

      const mapping = await ctx.prisma.scimGroupMapping.findFirst({
        where: { id: input.mappingId, organizationId: input.organizationId },
      });
      if (!mapping) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Mapping not found" });
      }

      return ctx.prisma.$transaction(async (tx) => {
        // Update the mapping
        const updateData: { role?: TeamUserRole; customRoleId?: string | null } = {};
        if (input.role !== undefined) {
          updateData.role = input.role;
          updateData.customRoleId =
            input.role === TeamUserRole.CUSTOM ? (input.customRoleId ?? null) : null;
        }

        const updatedMapping = await tx.scimGroupMapping.update({
          where: { id: input.mappingId },
          data: updateData,
        });

        // Re-sync TeamUser records for all members of this mapping
        if (updatedMapping.teamId) {
          const memberships = await tx.scimGroupMembership.findMany({
            where: { scimGroupMappingId: input.mappingId },
          });

          for (const membership of memberships) {
            // Get all mappings for this user targeting the same team
            const allMappingsForUserAndTeam =
              await tx.scimGroupMembership.findMany({
                where: {
                  userId: membership.userId,
                  scimGroupMapping: { teamId: updatedMapping.teamId },
                },
                include: { scimGroupMapping: true },
              });

            const roles = allMappingsForUserAndTeam
              .map((m) => m.scimGroupMapping.role)
              .filter((r): r is TeamUserRole => r !== null);

            if (roles.length > 0) {
              const effectiveRole = resolveHighestRole(roles);
              await tx.teamUser.upsert({
                where: {
                  userId_teamId: {
                    userId: membership.userId,
                    teamId: updatedMapping.teamId,
                  },
                },
                update: { role: effectiveRole },
                create: {
                  userId: membership.userId,
                  teamId: updatedMapping.teamId,
                  role: effectiveRole,
                },
              });
            }
          }
        }

        return updatedMapping;
      });
    }),

  /**
   * Deletes a mapping and cleans up member team assignments.
   * Members with other active mappings to the same team get their role recalculated.
   * Members with no other mappings to the team are removed from the team.
   */
  delete: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        mappingId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      await assertEnterprisePlan({
        organizationId: input.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
      });

      const mapping = await ctx.prisma.scimGroupMapping.findFirst({
        where: { id: input.mappingId, organizationId: input.organizationId },
      });
      if (!mapping) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Mapping not found" });
      }

      const service = ScimGroupService.create(ctx.prisma);
      await service.deleteMapping({
        mappingId: input.mappingId,
        organizationId: input.organizationId,
      });

      return { success: true };
    }),
});
