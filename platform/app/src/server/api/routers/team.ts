import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { TeamUserRole } from "~/generated/prisma/client";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { PERSONAL_TEAM_ARCHIVE_REFUSAL } from "~/server/app-layer/teams/team.service";
import { TeamService } from "~/server/teams/team.service";
import {
  assertEnterprisePlan,
  ENTERPRISE_FEATURE_ERRORS,
  isCustomRole,
} from "../enterprise";
import {
  checkOrganizationPermission,
  checkTeamPermission,
  hasOrganizationPermission,
} from "../rbac";

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
      const service = new TeamService({ prisma: ctx.prisma });
      return service.getTeamBySlugForUser({
        slug: input.slug,
        organizationId: input.organizationId,
        userId: ctx.session.user.id,
      });
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
      const callerId = ctx.session.user.id;
      const callerHasManage = await hasOrganizationPermission(
        ctx,
        input.organizationId,
        "organization:manage",
      );

      const service = new TeamService({ prisma: ctx.prisma });
      const teams = await service.getTeamsWithMembers({
        organizationId: input.organizationId,
        callerId,
        callerHasManage,
      });

      // Email-privacy redaction is request-scoped (depends on the caller), so it
      // stays here rather than in the service.
      if (!callerHasManage) {
        for (const team of teams) {
          for (const m of team.members) {
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
      const service = new TeamService({ prisma: ctx.prisma });
      return service.getTeamsWithRoleBindings({
        organizationId: input.organizationId,
      });
    }),

  getTeamWithMembers: protectedProcedure
    .input(z.object({ slug: z.string(), organizationId: z.string() }))
    // Stays at organization:view for the same picker reasons as
    // getTeamsWithMembers (the automations drawer's alert form, etc.).
    // Member emails are redacted below for non-admin callers, and a
    // non-admin lookup of someone else's personal workspace returns
    // NOT_FOUND (existence itself is private).
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input, ctx }) => {
      const callerId = ctx.session.user.id;
      const callerHasManage = await hasOrganizationPermission(
        ctx,
        input.organizationId,
        "organization:manage",
      );

      const service = new TeamService({ prisma: ctx.prisma });
      const team = await service.getTeamWithMembers({
        slug: input.slug,
        organizationId: input.organizationId,
      });

      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      }

      // Privacy floor: a non-admin probing for someone else's personal
      // workspace by slug gets a NOT_FOUND, not a 200-with-team. We
      // surface the same error a missing slug would for non-distinguishability.
      if (
        !callerHasManage &&
        team.isPersonal &&
        team.ownerUserId !== callerId
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      }

      // Email-privacy redaction is request-scoped (depends on the caller), so it
      // stays here rather than in the service.
      if (!callerHasManage) {
        for (const m of team.members) {
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

      return new TeamService({ prisma: ctx.prisma }).updateWithMembers({
        teamId: input.teamId,
        name: input.name,
        members: input.members,
        currentUserId: ctx.session.user.id,
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

      return new TeamService({ prisma: ctx.prisma }).createWithMembers({
        organizationId: input.organizationId,
        name: input.name,
        members: input.members,
        currentUserId: ctx.session.user.id,
      });
    }),
  archiveById: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .use(checkTeamPermission("team:delete"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      // Archiving a personal team is unrecoverable. The partial unique index
      // `Team_organizationId_ownerUserId_personal_key` covers every personal
      // team of an (organization, user) pair regardless of archivedAt, while
      // PersonalWorkspaceService looks its workspace up with `archivedAt:
      // null`. An archived personal team therefore stays invisible to the
      // service but keeps holding the index slot, so the next ensure() cannot
      // find the workspace, cannot create a replacement, and the user is left
      // without a personal workspace in that organization for good.
      const team = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { isPersonal: true },
      });
      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
      }
      if (team.isPersonal) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: PERSONAL_TEAM_ARCHIVE_REFUSAL,
        });
      }

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
      const service = new TeamService({ prisma: ctx.prisma });
      return service.removeMember({
        teamId: input.teamId,
        userId: input.userId,
        currentUserId: ctx.session.user.id,
      });
    }),
});
