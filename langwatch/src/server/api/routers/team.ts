import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  assertEnterprisePlan,
  isCustomRole,
  ENTERPRISE_FEATURE_ERRORS,
} from "../enterprise";
import {
  createLicenseEnforcementService,
  LimitExceededError,
} from "../../license-enforcement";
import { captureException } from "~/utils/posthogErrorCapture";
import { slugify } from "~/utils/slugify";
import { checkOrganizationPermission, checkTeamPermission } from "../rbac";

// Reusable schema for team member role validation
const teamMemberRoleSchema = z
  .object({
    userId: z.string(),
    role: z.union([
      z.nativeEnum(TeamUserRole),
      z
        .string()
        .regex(
          /^custom:[a-zA-Z0-9_-]+$/,
          "Custom role must be in format 'custom:{roleId}'",
        ),
    ]),
    customRoleId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const hasCustom = isCustomRole(data.role);

    if (hasCustom) {
      if (!data.customRoleId || data.customRoleId.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "customRoleId is required when using a custom role",
          path: ["customRoleId"],
        });
      }
    } else {
      if (data.customRoleId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "customRoleId must not be provided when using a built-in role",
          path: ["customRoleId"],
        });
      }
    }
  });

export const teamRouter = createTRPCRouter({
  getBySlug: protectedProcedure
    .input(z.object({ organizationId: z.string(), slug: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const prisma = ctx.prisma;

      const team = await prisma.team.findFirst({
        where: {
          slug: input.slug,
          organizationId: input.organizationId,
          members: {
            some: {
              userId: userId,
            },
          },
        },
      });

      return team;
    }),
  getTeamsWithMembers: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const teams = await prisma.team.findMany({
        where: {
          organizationId: input.organizationId,
          archivedAt: null,
        },
        include: {
          members: {
            include: {
              user: true,
              assignedRole: true,
            },
          },
          projects: {
            where: {
              archivedAt: null,
            },
          },
        },
      });

      return teams;
    }),
  /**
   * Returns teams enriched with role-binding data for the new Teams & Projects page.
   *
   * For each team:
   * - directMembers: users/groups with a TEAM-scoped RoleBinding
   * - projectOnlyAccess: users with PROJECT-scoped bindings inside this team (no team binding)
   * - projectAccess: per-project computed access (inherited + project-level overrides)
   */
  getTeamsWithRoleBindings: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      const { organizationId } = input;

      const teams = await prisma.team.findMany({
        where: { organizationId, archivedAt: null },
        include: {
          projects: { where: { archivedAt: null }, orderBy: { name: "asc" } },
        },
        orderBy: { name: "asc" },
      });

      const results = await Promise.all(
        teams.map(async (team) => {
          const projectIds = team.projects.map((p) => p.id);

          // ── Fetch all RoleBindings touching this team (team-level + project-level) ──
          const [teamBindings, projectBindings] = await Promise.all([
            prisma.roleBinding.findMany({
              where: {
                organizationId,
                scopeType: RoleBindingScopeType.TEAM,
                scopeId: team.id,
              },
              include: {
                user: { select: { id: true, name: true, email: true } },
                group: { select: { id: true, name: true, scimSource: true } },
                customRole: { select: { id: true, name: true } },
              },
            }),
            projectIds.length > 0
              ? prisma.roleBinding.findMany({
                  where: {
                    organizationId,
                    scopeType: RoleBindingScopeType.PROJECT,
                    scopeId: { in: projectIds },
                  },
                  include: {
                    user: { select: { id: true, name: true, email: true } },
                    group: { select: { id: true, name: true, scimSource: true } },
                    customRole: { select: { id: true, name: true } },
                  },
                })
              : [],
          ]);

          // ── Build directMembers from team-level bindings ──
          const directMembers = teamBindings.map((b) => ({
            bindingId: b.id,
            userId: b.userId,
            groupId: b.groupId,
            name: b.user?.name ?? b.group?.name ?? "Unknown",
            email: b.user?.email ?? null,
            role: b.role,
            customRoleId: b.customRoleId,
          }));

          // ── Collect userIds that have a team-level binding ──
          const teamBoundUserIds = new Set(
            teamBindings.filter((b) => b.userId).map((b) => b.userId!),
          );

          // ── Build projectOnlyAccess: users with project bindings but NO team binding ──
          const projectOnlyMap = new Map<string, {
            bindingId: string;
            userId: string;
            name: string;
            email: string | null;
            role: TeamUserRole;
            customRoleId: string | null;
            projectId: string;
            projectName: string;
          }>();

          for (const b of projectBindings) {
            if (!b.userId) continue;
            if (teamBoundUserIds.has(b.userId)) continue;
            const project = team.projects.find((p) => p.id === b.scopeId);
            if (!project) continue;
            const key = `${b.userId}:${b.scopeId}`;
            if (!projectOnlyMap.has(key)) {
              projectOnlyMap.set(key, {
                bindingId: b.id,
                userId: b.userId,
                name: b.user?.name ?? b.userId,
                email: b.user?.email ?? null,
                role: b.role,
                customRoleId: b.customRoleId,
                projectId: project.id,
                projectName: project.name,
              });
            }
          }

          // ── Build per-project access list ──
          const projectAccess: Record<string, Array<{
            bindingId: string | null;
            userId: string | null;
            groupId: string | null;
            name: string;
            email: string | null;
            role: TeamUserRole;
            customRoleId: string | null;
            source: "team" | "direct" | "override";
            teamRole?: TeamUserRole;
          }>> = {};

          for (const proj of team.projects) {
            const inherited = directMembers.map((m) => ({
              bindingId: m.bindingId,
              userId: m.userId,
              groupId: m.groupId,
              name: m.name,
              email: m.email,
              role: m.role,
              customRoleId: m.customRoleId,
              source: "team" as const,
            }));

            const projBindings = projectBindings.filter(
              (b) => b.scopeId === proj.id,
            );

            const projectLevel = projBindings.map((b) => {
              const teamBinding = teamBindings.find(
                (tb) => tb.userId && tb.userId === b.userId,
              );
              return {
                bindingId: b.id,
                userId: b.userId,
                groupId: b.groupId,
                name: b.user?.name ?? b.group?.name ?? "Unknown",
                email: b.user?.email ?? null,
                role: b.role,
                customRoleId: b.customRoleId,
                source: teamBinding ? ("override" as const) : ("direct" as const),
                teamRole: teamBinding?.role,
              };
            });

            // Remove "inherited" entries that have a project-level override
            const overriddenUserIds = new Set(
              projBindings.filter((b) => b.userId).map((b) => b.userId!),
            );
            const filteredInherited = inherited.filter(
              (m) => !m.userId || !overriddenUserIds.has(m.userId),
            );

            projectAccess[proj.id] = [...filteredInherited, ...projectLevel];
          }

          return {
            id: team.id,
            name: team.name,
            slug: team.slug,
            projects: team.projects,
            directMembers,
            projectOnlyAccess: [...projectOnlyMap.values()],
            projectAccess,
          };
        }),
      );

      return results;
    }),

  getTeamWithMembers: protectedProcedure
    .input(z.object({ slug: z.string(), organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const team = await prisma.team.findFirst({
        where: {
          slug: input.slug,
          organizationId: input.organizationId,
        },
        include: {
          members: {
            include: {
              user: true,
              assignedRole: true,
            },
          },
          projects: true,
        },
      });

      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      }

      return team;
    }),
  update: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        name: z.string(),
        members: z.array(teamMemberRoleSchema),
      }),
    )
    .use(checkTeamPermission("team:manage"))
    .mutation(async ({ input, ctx }) => {
      const hasCustomRoleMember = input.members.some((m) =>
        isCustomRole(m.role),
      );
      if (hasCustomRoleMember) {
        const team = await ctx.prisma.team.findUnique({
          where: { id: input.teamId },
          select: { organizationId: true },
        });
        if (!team) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Team not found",
          });
        }
        await assertEnterprisePlan({
          organizationId: team.organizationId,
          user: ctx.session.user,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
        });
      }

      const prisma = ctx.prisma;

      // Always fetch team to get organizationId (needed for RoleBinding writes)
      const teamRecord = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { organizationId: true },
      });
      if (!teamRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
      }
      const { organizationId } = teamRecord;

      // Validate custom roles belong to this org
      if (input.members.some((m) => isCustomRole(m.role))) {
        for (const member of input.members.filter((m) => isCustomRole(m.role))) {
          if (!member.customRoleId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `customRoleId is required when role is a custom role for user ${member.userId}`,
            });
          }
          const customRole = await prisma.customRole.findUnique({
            where: { id: member.customRoleId },
            select: { organizationId: true },
          });
          if (!customRole) {
            throw new TRPCError({ code: "NOT_FOUND", message: `Custom role ${member.customRoleId} not found` });
          }
          if (customRole.organizationId !== organizationId) {
            throw new TRPCError({ code: "FORBIDDEN", message: `Custom role ${member.customRoleId} does not belong to team's organization` });
          }
        }
      }

      return await prisma.$transaction(async (tx) => {
        // ── Rename team ──
        await tx.team.update({ where: { id: input.teamId }, data: { name: input.name } });

        if (input.members.length === 0) return { success: true };

        const newMembersMap = new Map(
          input.members.map((m) => [m.userId, m]),
        );

        // ── RoleBinding ──
        const currentBindings = await tx.roleBinding.findMany({
          where: { organizationId, scopeType: RoleBindingScopeType.TEAM, scopeId: input.teamId, userId: { not: null } },
          select: { id: true, userId: true, role: true, customRoleId: true },
        });
        const currentBindingMap = new Map(currentBindings.map((b) => [b.userId!, b]));

        const rbToRemove = currentBindings.filter((b) => !newMembersMap.has(b.userId!)).map((b) => b.id);
        const rbToAdd = input.members.filter((m) => !currentBindingMap.has(m.userId));
        const rbToUpdate = input.members.filter((m) => {
          const existing = currentBindingMap.get(m.userId);
          if (!existing) return false;
          const newRole = isCustomRole(m.role) ? TeamUserRole.CUSTOM : (m.role as TeamUserRole);
          return existing.role !== newRole || existing.customRoleId !== (m.customRoleId ?? null);
        });

        if (rbToRemove.length > 0) {
          await tx.roleBinding.deleteMany({ where: { id: { in: rbToRemove } } });
        }
        for (const member of rbToAdd) {
          await tx.roleBinding.create({
            data: {
              organizationId,
              userId: member.userId,
              role: isCustomRole(member.role) ? TeamUserRole.CUSTOM : (member.role as TeamUserRole),
              customRoleId: isCustomRole(member.role) ? (member.customRoleId ?? null) : null,
              scopeType: RoleBindingScopeType.TEAM,
              scopeId: input.teamId,
            },
          });
        }
        for (const member of rbToUpdate) {
          const existing = currentBindingMap.get(member.userId)!;
          await tx.roleBinding.update({
            where: { id: existing.id },
            data: {
              role: isCustomRole(member.role) ? TeamUserRole.CUSTOM : (member.role as TeamUserRole),
              customRoleId: isCustomRole(member.role) ? (member.customRoleId ?? null) : null,
            },
          });
        }

        return { success: true };
      });
    }),
  createTeamWithMembers: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string(),
        members: z.array(teamMemberRoleSchema),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const hasCustomRoleMember = input.members.some((m) =>
        isCustomRole(m.role),
      );
      if (hasCustomRoleMember) {
        await assertEnterprisePlan({
          organizationId: input.organizationId,
          user: ctx.session.user,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
        });
      }

      const prisma = ctx.prisma;

      // Check teams license limit via LicenseEnforcementService
      const enforcement = createLicenseEnforcementService(prisma);
      try {
        await enforcement.enforceLimitByOrganization({
          organizationId: input.organizationId,
          limitType: "teams",
          user: ctx.session.user,
        });
      } catch (error) {
        if (error instanceof LimitExceededError) {
          void getApp()
            .usageLimits.notifyResourceLimitReached({
              organizationId: input.organizationId,
              limitType: error.limitType,
              current: error.current,
              max: error.max,
            })
            .catch(captureException);

          throw new TRPCError({
            code: "FORBIDDEN",
            message: error.message,
            cause: {
              limitType: error.limitType,
              current: error.current,
              max: error.max,
            },
          });
        }
        throw error;
      }

      const teamNanoId = nanoid();
      const teamId = `team_${teamNanoId}`;
      const teamSlug =
        slugify(input.name, { lower: true, strict: true }) +
        "-" +
        teamNanoId.substring(0, 6);

      return await prisma.$transaction(async (tx) => {
        const team = await tx.team.create({
          data: {
            id: teamId,
            name: input.name,
            slug: teamSlug,
            organizationId: input.organizationId,
          },
        });

        for (const member of input.members) {
          const memberIsCustomRole = isCustomRole(member.role);

          if (memberIsCustomRole && !member.customRoleId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `customRoleId is required when role is a custom role for user ${member.userId}`,
            });
          }

          const memberRole = memberIsCustomRole
            ? TeamUserRole.CUSTOM
            : (member.role as TeamUserRole);

          await tx.teamUser.create({
            data: {
              userId: member.userId,
              teamId: team.id,
              role: memberRole,
              assignedRoleId: memberIsCustomRole ? member.customRoleId : null,
            },
          });

          if (memberIsCustomRole) {
            // Verify the custom role belongs to the same organization
            const customRole = await tx.customRole.findUnique({
              where: { id: member.customRoleId! },
              select: { organizationId: true },
            });

            if (
              !customRole ||
              customRole.organizationId !== team.organizationId
            ) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Custom role ${member.customRoleId} is invalid for this team`,
              });
            }
          }

          await tx.roleBinding.create({
            data: {
              organizationId: input.organizationId,
              userId: member.userId,
              role: memberRole,
              customRoleId: memberIsCustomRole ? (member.customRoleId ?? null) : null,
              scopeType: RoleBindingScopeType.TEAM,
              scopeId: team.id,
            },
          });
        }

        // Post-creation validation: ensure we have at least one admin
        const finalAdminCount = await tx.teamUser.count({
          where: {
            teamId: team.id,
            role: TeamUserRole.ADMIN,
          },
        });

        if (finalAdminCount === 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Team must have at least one admin",
          });
        }

        return team;
      });
    }),
  archiveById: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .use(checkTeamPermission("team:delete"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      await prisma.team.update({
        where: { id: input.teamId },
        data: { archivedAt: new Date() },
      });
      return { success: true };
    }),
  removeMember: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        userId: z.string(),
      }),
    )
    .use(checkTeamPermission("team:manage"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      return await prisma.$transaction(async (tx) => {
        // Validate that the team exists
        const team = await tx.team.findUnique({
          where: { id: input.teamId },
          select: { id: true, name: true, organizationId: true },
        });

        if (!team) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
        }

        // Lock and validate admin count within transaction
        const adminBindings = await tx.roleBinding.findMany({
          where: {
            organizationId: team.organizationId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: input.teamId,
            role: TeamUserRole.ADMIN,
            userId: { not: null },
          },
          select: { userId: true },
        });

        const adminCount = adminBindings.length;

        if (adminCount === 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "No admin found for this team",
          });
        }

        // Check if the target user is currently a member
        const targetBinding = await tx.roleBinding.findFirst({
          where: {
            organizationId: team.organizationId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: input.teamId,
            userId: input.userId,
          },
          select: { role: true },
        });

        if (!targetBinding) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User is not a member of this team",
          });
        }

        const isTargetUserAdmin = targetBinding.role === TeamUserRole.ADMIN;

        if (adminCount === 1 && isTargetUserAdmin) {
          if (input.userId === ctx.session.user.id) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You cannot remove yourself from the last admin position in this team",
            });
          }

          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Cannot remove the last admin from this team",
          });
        }

        // Remove RoleBinding
        await tx.roleBinding.deleteMany({
          where: {
            organizationId: team.organizationId,
            userId: input.userId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: input.teamId,
          },
        });

        // Post-removal validation: ensure we still have at least one admin
        const finalAdminCount = await tx.roleBinding.count({
          where: {
            organizationId: team.organizationId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: input.teamId,
            role: TeamUserRole.ADMIN,
            userId: { not: null },
          },
        });

        if (finalAdminCount === 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Operation would result in no admins for this team",
          });
        }

        // Return updated team data for client cache invalidation
        const updatedTeam = await tx.team.findUnique({
          where: { id: input.teamId },
          include: {
            members: {
              include: {
                user: true,
                assignedRole: true,
              },
            },
          },
        });

        return {
          success: true,
          team: updatedTeam,
          removedUserId: input.userId,
        };
      });
    }),
});
