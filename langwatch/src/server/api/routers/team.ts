import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { z } from "zod";
import { KSUID_RESOURCES } from "~/utils/constants";
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
import {
  checkOrganizationPermission,
  checkTeamPermission,
  hasOrganizationPermission,
} from "../rbac";
import { TeamService } from "~/server/teams/team.service";

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
    // Stays at organization:view because non-admin callers
    // (AddAutomationDrawer, GroupBindingInputRow, project pickers,
    // onboarding) need to enumerate teams + their members. Member
    // emails are PII and get redacted below for non-admin callers,
    // and other users' personal-workspace teams are filtered out
    // entirely (their existence is itself private).
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      const callerId = ctx.session.user.id;
      const callerHasManage = await hasOrganizationPermission(
        ctx,
        input.organizationId,
        "organization:manage",
      );

      const teams = await prisma.team.findMany({
        where: {
          organizationId: input.organizationId,
          archivedAt: null,
          // Privacy floor: a member never sees another user's personal
          // workspace as a "team". Admins see everything.
          ...(callerHasManage
            ? {}
            : {
                OR: [
                  { isPersonal: false },
                  { isPersonal: true, ownerUserId: callerId },
                ],
              }),
        },
        include: {
          members: {
            orderBy: [{ user: { name: "asc" } }, { user: { email: "asc" } }, { userId: "asc" }],
            include: {
              user: true,
              assignedRole: true,
            },
          },
          projects: {
            where: {
              archivedAt: null,
              kind: { not: "internal_governance" },
            },
          },
        },
      });

      if (!callerHasManage) {
        for (const team of teams) {
          for (const m of team.members ?? []) {
            if (m.user.id !== callerId) {
              m.user.email = null;
            }
          }
        }
      }

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
    // Tightened from organization:view to manage — exposes per-team
    // direct members + role bindings + per-project access maps,
    // which is admin-surface authorization data. Sole TS caller is
    // settings/teams.tsx, an admin-only page.
    .use(checkOrganizationPermission("organization:manage"))
    .query(async ({ input, ctx }) => {
      const service = new TeamService(ctx.prisma);
      return service.getTeamsWithRoleBindings({ organizationId: input.organizationId });
    }),

  getTeamWithMembers: protectedProcedure
    .input(z.object({ slug: z.string(), organizationId: z.string() }))
    // Stays at organization:view for the same picker reasons as
    // getTeamsWithMembers (AddAutomationDrawer, AlertDrawer, etc.).
    // Member emails are redacted below for non-admin callers, and a
    // non-admin lookup of someone else's personal workspace returns
    // NOT_FOUND (existence itself is private).
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      const callerId = ctx.session.user.id;
      const callerHasManage = await hasOrganizationPermission(
        ctx,
        input.organizationId,
        "organization:manage",
      );

      const team = await prisma.team.findFirst({
        where: {
          slug: input.slug,
          organizationId: input.organizationId,
        },
        include: {
          members: {
            orderBy: [{ user: { name: "asc" } }, { user: { email: "asc" } }, { userId: "asc" }],
            include: {
              user: true,
              assignedRole: true,
            },
          },
          projects: {
            where: {
              archivedAt: null,
              kind: { not: "internal_governance" },
            },
          },
        },
      });

      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      }

      // Privacy floor: a non-admin probing for someone else's personal
      // workspace by slug gets a NOT_FOUND, not a 200-with-team. We
      // surface the same error a missing slug would for non-distinguishability.
      if (!callerHasManage && team.isPersonal && team.ownerUserId !== callerId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      }

      if (!callerHasManage) {
        for (const m of team.members ?? []) {
          if (m.user.id !== callerId) {
            m.user.email = null;
          }
        }
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
            select: { organizationId: true, kind: true },
          });
          if (!customRole || customRole.kind !== "custom") {
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
              id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
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

          if (memberIsCustomRole) {
            // Verify the custom role belongs to the same organization and is user-assignable
            const customRole = await tx.customRole.findUnique({
              where: { id: member.customRoleId! },
              select: { organizationId: true, kind: true },
            });

            if (
              !customRole ||
              customRole.kind !== "custom" ||
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
              id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
              organizationId: input.organizationId,
              userId: member.userId,
              role: memberRole,
              customRoleId: memberIsCustomRole ? (member.customRoleId ?? null) : null,
              scopeType: RoleBindingScopeType.TEAM,
              scopeId: team.id,
            },
          });
        }

        // Post-creation validation: ensure we have at least one admin (direct user or group binding)
        const finalAdminCount = await tx.roleBinding.count({
          where: {
            organizationId: input.organizationId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: team.id,
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
      const service = new TeamService(ctx.prisma);
      return service.removeMember({
        teamId: input.teamId,
        userId: input.userId,
        currentUserId: ctx.session.user.id,
      });
    }),
});
