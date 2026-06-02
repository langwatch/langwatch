import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { z } from "zod";
import { KSUID_RESOURCES } from "~/utils/constants";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  assertEnterprisePlan,
  isCustomRole,
  ENTERPRISE_FEATURE_ERRORS,
} from "../enterprise";
import { slugify } from "~/utils/slugify";
import {
  checkOrganizationPermission,
  checkTeamPermission,
  hasOrganizationPermission,
} from "../rbac";
import { TeamService, TEAM_ROLE_PRIORITY } from "~/server/teams/team.service";

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
      const service = new TeamService(ctx.prisma);
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

      const service = new TeamService(ctx.prisma);
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
      const callerId = ctx.session.user.id;
      const callerHasManage = await hasOrganizationPermission(
        ctx,
        input.organizationId,
        "organization:manage",
      );

      const service = new TeamService(ctx.prisma);
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
      if (!callerHasManage && team.isPersonal && team.ownerUserId !== callerId) {
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
        // A user can hold MORE THAN ONE TEAM binding on the same team (the
        // partial unique indexes allow a built-in role plus additive custom-role
        // grants at one scope), and RBAC unions them. This settings form shows
        // and edits ONLY the displayed membership — the highest-privilege binding
        // (same selection the read path uses, TEAM_ROLE_PRIORITY). So on save we
        // update just that binding and PRESERVE the user's other (additive)
        // bindings; we must not delete them, or a routine autosaved edit would
        // silently revoke custom-role grants. Removing a user from the team is
        // unambiguous, so that path still drops all of their bindings.
        const currentBindings = await tx.roleBinding.findMany({
          where: { organizationId, scopeType: RoleBindingScopeType.TEAM, scopeId: input.teamId, userId: { not: null } },
          select: { id: true, userId: true, role: true, customRoleId: true },
        });
        const currentBindingsByUser = new Map<string, typeof currentBindings>();
        for (const binding of currentBindings) {
          const list = currentBindingsByUser.get(binding.userId!) ?? [];
          list.push(binding);
          currentBindingsByUser.set(binding.userId!, list);
        }

        const targetRole = (m: (typeof input.members)[number]) =>
          isCustomRole(m.role) ? TeamUserRole.CUSTOM : (m.role as TeamUserRole);
        const targetCustomRoleId = (m: (typeof input.members)[number]) =>
          isCustomRole(m.role) ? (m.customRoleId ?? null) : null;

        // The displayed binding = highest-privilege one, matching the read path.
        const displayedBinding = (bindings: typeof currentBindings) =>
          [...bindings].sort(
            (a, b) => TEAM_ROLE_PRIORITY[a.role] - TEAM_ROLE_PRIORITY[b.role],
          )[0]!;

        const idsToRemove: string[] = [];
        const toUpdate: { id: string; role: TeamUserRole; customRoleId: string | null }[] = [];
        const toCreate: (typeof input.members)[number][] = [];

        // Drop every binding belonging to a user no longer on the team.
        for (const [userId, bindings] of currentBindingsByUser) {
          if (!newMembersMap.has(userId)) {
            idsToRemove.push(...bindings.map((b) => b.id));
          }
        }

        // For each submitted user: edit only the displayed binding; leave the
        // rest (additive grants) untouched.
        for (const member of input.members) {
          const existing = currentBindingsByUser.get(member.userId) ?? [];
          const role = targetRole(member);
          const customRoleId = targetCustomRoleId(member);
          if (existing.length === 0) {
            toCreate.push(member);
            continue;
          }
          const displayed = displayedBinding(existing);
          if (displayed.role === role && displayed.customRoleId === customRoleId) {
            continue; // displayed binding already matches — nothing to do
          }
          // If the target grant already exists on another binding, updating into
          // it would collide with the partial unique index, so drop the
          // displayed binding instead (the grant is already present).
          const targetAlreadyHeld = existing.some(
            (b) => b.id !== displayed.id && b.role === role && b.customRoleId === customRoleId,
          );
          if (targetAlreadyHeld) {
            idsToRemove.push(displayed.id);
          } else {
            toUpdate.push({ id: displayed.id, role, customRoleId });
          }
        }

        if (idsToRemove.length > 0) {
          await tx.roleBinding.deleteMany({ where: { id: { in: idsToRemove } } });
        }
        for (const { id, role, customRoleId } of toUpdate) {
          await tx.roleBinding.update({ where: { id }, data: { role, customRoleId } });
        }
        for (const member of toCreate) {
          await tx.roleBinding.create({
            data: {
              id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
              organizationId,
              userId: member.userId,
              role: targetRole(member),
              customRoleId: targetCustomRoleId(member),
              scopeType: RoleBindingScopeType.TEAM,
              scopeId: input.teamId,
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
