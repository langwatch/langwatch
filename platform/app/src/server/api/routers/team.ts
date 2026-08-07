import { generate } from "@langwatch/ksuid";
import type { Prisma, PrismaClient } from "@prisma/client";
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import type { PlanProviderUser } from "~/server/app-layer/subscription/plan-provider";
import {
  PERSONAL_TEAM_ARCHIVE_REFUSAL,
  PERSONAL_TEAM_MEMBERSHIP_REFUSAL,
} from "~/server/app-layer/teams/team.service";
import { assertUsersInOrganization } from "~/server/organizations/assertUsersInOrganization";
import { TEAM_ROLE_PRIORITY, TeamService } from "~/server/teams/team.service";
import { KSUID_RESOURCES } from "~/utils/constants";
import { slugify } from "~/utils/slugify";
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

type TeamMemberInput = z.infer<typeof teamMemberRoleSchema>;

const targetRoleForMember = (m: TeamMemberInput): TeamUserRole =>
  isCustomRole(m.role) ? TeamUserRole.CUSTOM : (m.role as TeamUserRole);

const targetCustomRoleIdForMember = (m: TeamMemberInput): string | null =>
  isCustomRole(m.role) ? (m.customRoleId ?? null) : null;

/**
 * The displayed binding among a user's (possibly several, additive) TEAM
 * bindings — the highest-privilege one, matching the read path
 * (TEAM_ROLE_PRIORITY).
 */
function highestPriorityBinding<T extends { role: TeamUserRole }>(
  bindings: T[],
): T {
  return [...bindings].sort(
    (a, b) => TEAM_ROLE_PRIORITY[a.role] - TEAM_ROLE_PRIORITY[b.role],
  )[0]!;
}

/**
 * Custom-role team bindings require the enterprise plan. Looks the team's
 * organization up itself (the `update` input carries only `teamId`) and
 * skips both the lookup and the plan check entirely when no submitted
 * member uses a custom role.
 */
async function assertUpdateAllowsCustomRoleMembers({
  prisma,
  teamId,
  members,
  actorUser,
}: {
  prisma: PrismaClient;
  teamId: string;
  members: TeamMemberInput[];
  actorUser: PlanProviderUser;
}): Promise<void> {
  if (!members.some((m) => isCustomRole(m.role))) return;

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { organizationId: true },
  });
  if (!team) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
  }
  await assertEnterprisePlan({
    organizationId: team.organizationId,
    user: actorUser,
    errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
  });
}

/**
 * A personal team is single-member by definition: its owner holds the one
 * ADMIN binding PersonalWorkspaceService provisions, and plan-limit counting
 * exempts the team on that basis. Members and roles are therefore not
 * editable here. Only submissions that keep the provisioned membership (or
 * touch none at all, e.g. a rename) go through; everything else needs a
 * shared team.
 */
function assertPersonalTeamMembershipUnchanged({
  teamRecord,
  members,
}: {
  teamRecord: { isPersonal: boolean; ownerUserId: string | null };
  members: TeamMemberInput[];
}): void {
  if (!teamRecord.isPersonal) return;

  const keepsProvisionedMembership =
    members.length === 0 ||
    (members.length === 1 &&
      members[0]!.userId === teamRecord.ownerUserId &&
      members[0]!.role === TeamUserRole.ADMIN);
  if (!keepsProvisionedMembership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: PERSONAL_TEAM_MEMBERSHIP_REFUSAL,
    });
  }
}

/** Every submitted custom-role member must point at a `custom` role that belongs to this org. */
async function assertCustomRolesBelongToOrg({
  prisma,
  organizationId,
  members,
}: {
  prisma: PrismaClient;
  organizationId: string;
  members: TeamMemberInput[];
}): Promise<void> {
  for (const member of members.filter((m) => isCustomRole(m.role))) {
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
    if (customRole?.kind !== "custom") {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Custom role ${member.customRoleId} not found`,
      });
    }
    if (customRole.organizationId !== organizationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Custom role ${member.customRoleId} does not belong to team's organization`,
      });
    }
  }
}

type CurrentTeamBinding = {
  id: string;
  userId: string | null;
  role: TeamUserRole;
  customRoleId: string | null;
};

/** Every existing TEAM RoleBinding for this team, grouped by the user it names. */
async function loadCurrentTeamBindingsByUser({
  tx,
  organizationId,
  teamId,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  teamId: string;
}): Promise<Map<string, CurrentTeamBinding[]>> {
  const currentBindings = await tx.roleBinding.findMany({
    where: {
      organizationId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
      userId: { not: null },
    },
    select: { id: true, userId: true, role: true, customRoleId: true },
  });
  const currentBindingsByUser = new Map<string, CurrentTeamBinding[]>();
  for (const binding of currentBindings) {
    const list = currentBindingsByUser.get(binding.userId!) ?? [];
    list.push(binding);
    currentBindingsByUser.set(binding.userId!, list);
  }
  return currentBindingsByUser;
}

type MembershipBindingPlan = {
  idsToRemove: string[];
  toUpdate: Array<{
    id: string;
    role: TeamUserRole;
    customRoleId: string | null;
  }>;
  toCreate: TeamMemberInput[];
};

type BindingChangeForMember =
  | { kind: "create"; member: TeamMemberInput }
  | {
      kind: "update";
      id: string;
      role: TeamUserRole;
      customRoleId: string | null;
    }
  | { kind: "remove"; id: string }
  | { kind: "noop" };

/**
 * What one submitted member's displayed binding needs, if anything: create
 * one when the user has none yet, leave it alone when the displayed binding
 * already matches, update it in place, or — when the target grant already
 * exists on ANOTHER of the user's bindings (updating into it would collide
 * with the partial unique index) — remove the displayed one instead, since
 * the grant is already present via the other binding.
 */
function planBindingChangeForMember({
  member,
  existing,
}: {
  member: TeamMemberInput;
  existing: CurrentTeamBinding[];
}): BindingChangeForMember {
  if (existing.length === 0) {
    return { kind: "create", member };
  }

  const role = targetRoleForMember(member);
  const customRoleId = targetCustomRoleIdForMember(member);
  const displayed = highestPriorityBinding(existing);
  if (displayed.role === role && displayed.customRoleId === customRoleId) {
    return { kind: "noop" }; // displayed binding already matches — nothing to do
  }

  const targetAlreadyHeld = existing.some(
    (b) =>
      b.id !== displayed.id &&
      b.role === role &&
      b.customRoleId === customRoleId,
  );
  return targetAlreadyHeld
    ? { kind: "remove", id: displayed.id }
    : { kind: "update", id: displayed.id, role, customRoleId };
}

/** Every binding id belonging to a user no longer in `members` — dropped unconditionally, unlike a submitted user's own (additive) bindings. */
function idsForRemovedMembers({
  members,
  currentBindingsByUser,
}: {
  members: TeamMemberInput[];
  currentBindingsByUser: Map<string, CurrentTeamBinding[]>;
}): string[] {
  const newMembersMap = new Map(members.map((m) => [m.userId, m]));
  const idsToRemove: string[] = [];
  for (const [userId, bindings] of currentBindingsByUser) {
    if (!newMembersMap.has(userId)) {
      idsToRemove.push(...bindings.map((b) => b.id));
    }
  }
  return idsToRemove;
}

function applyBindingChangeToPlan(
  plan: MembershipBindingPlan,
  change: BindingChangeForMember,
): void {
  if (change.kind === "create") {
    plan.toCreate.push(change.member);
  } else if (change.kind === "update") {
    plan.toUpdate.push({
      id: change.id,
      role: change.role,
      customRoleId: change.customRoleId,
    });
  } else if (change.kind === "remove") {
    plan.idsToRemove.push(change.id);
  }
}

/**
 * Diffs submitted members against current TEAM RoleBindings. A user can hold
 * MORE THAN ONE TEAM binding on the same team (the partial unique indexes
 * allow a built-in role plus additive custom-role grants at one scope), and
 * RBAC unions them. This settings form shows and edits ONLY the displayed
 * membership — the highest-privilege binding (same selection the read path
 * uses, TEAM_ROLE_PRIORITY). So the plan updates just that binding and
 * PRESERVES the user's other (additive) bindings; we must not delete them,
 * or a routine autosaved edit would silently revoke custom-role grants.
 * Removing a user from the team is unambiguous, so that path still drops
 * all of their bindings.
 */
function planMembershipBindingChanges({
  members,
  currentBindingsByUser,
}: {
  members: TeamMemberInput[];
  currentBindingsByUser: Map<string, CurrentTeamBinding[]>;
}): MembershipBindingPlan {
  const plan: MembershipBindingPlan = {
    // Drop every binding belonging to a user no longer on the team.
    idsToRemove: idsForRemovedMembers({ members, currentBindingsByUser }),
    toUpdate: [],
    toCreate: [],
  };

  // For each submitted user: edit only the displayed binding; leave the
  // rest (additive grants) untouched.
  for (const member of members) {
    const existing = currentBindingsByUser.get(member.userId) ?? [];
    const change = planBindingChangeForMember({ member, existing });
    applyBindingChangeToPlan(plan, change);
  }

  return plan;
}

/** Applies a `planMembershipBindingChanges` plan: delete, then update, then create. */
async function applyMembershipBindingChanges({
  tx,
  organizationId,
  teamId,
  plan,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  teamId: string;
  plan: MembershipBindingPlan;
}): Promise<void> {
  if (plan.idsToRemove.length > 0) {
    await tx.roleBinding.deleteMany({
      where: { id: { in: plan.idsToRemove } },
    });
  }
  for (const { id, role, customRoleId } of plan.toUpdate) {
    await tx.roleBinding.update({
      where: { id },
      data: { role, customRoleId },
    });
  }
  for (const member of plan.toCreate) {
    await tx.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId,
        userId: member.userId,
        role: targetRoleForMember(member),
        customRoleId: targetCustomRoleIdForMember(member),
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
      },
    });
  }
}

/**
 * Custom-role team bindings require the enterprise plan; skips the check
 * entirely when no submitted member uses one.
 */
async function assertCreateAllowsCustomRoleMembers({
  members,
  organizationId,
  actorUser,
}: {
  members: TeamMemberInput[];
  organizationId: string;
  actorUser: PlanProviderUser;
}): Promise<void> {
  if (!members.some((m) => isCustomRole(m.role))) return;
  await assertEnterprisePlan({
    organizationId,
    user: actorUser,
    errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
  });
}

/**
 * Creates one member's TEAM RoleBinding on a just-created team, validating
 * (for a custom role) that the customRoleId was supplied and belongs to
 * this org.
 */
async function createMemberBindingForNewTeam({
  tx,
  organizationId,
  team,
  member,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  team: { id: string; organizationId: string };
  member: TeamMemberInput;
}): Promise<void> {
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
      customRole?.kind !== "custom" ||
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
      organizationId,
      userId: member.userId,
      role: memberRole,
      customRoleId: memberIsCustomRole ? (member.customRoleId ?? null) : null,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: team.id,
    },
  });
}

/** Fails closed: a brand-new team must end up with at least one ADMIN binding. */
async function assertNewTeamHasAdmin({
  tx,
  organizationId,
  teamId,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  teamId: string;
}): Promise<void> {
  const finalAdminCount = await tx.roleBinding.count({
    where: {
      organizationId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
      role: TeamUserRole.ADMIN,
    },
  });

  if (finalAdminCount === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Team must have at least one admin",
    });
  }
}

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
      await assertUpdateAllowsCustomRoleMembers({
        prisma: ctx.prisma,
        teamId: input.teamId,
        members: input.members,
        actorUser: ctx.session.user,
      });

      const prisma = ctx.prisma;

      // Always fetch team to get organizationId (needed for RoleBinding writes)
      const teamRecord = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { organizationId: true, isPersonal: true, ownerUserId: true },
      });
      if (!teamRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
      }
      const { organizationId } = teamRecord;

      assertPersonalTeamMembershipUnchanged({
        teamRecord,
        members: input.members,
      });
      await assertUsersInOrganization(
        prisma,
        organizationId,
        input.members.map((member) => member.userId),
      );
      await assertCustomRolesBelongToOrg({
        prisma,
        organizationId,
        members: input.members,
      });

      return await prisma.$transaction(async (tx) => {
        // ── Rename team ──
        await tx.team.update({
          where: { id: input.teamId },
          data: { name: input.name },
        });

        if (input.members.length === 0) return { success: true };

        // ── RoleBinding ──
        const currentBindingsByUser = await loadCurrentTeamBindingsByUser({
          tx,
          organizationId,
          teamId: input.teamId,
        });
        const plan = planMembershipBindingChanges({
          members: input.members,
          currentBindingsByUser,
        });
        await applyMembershipBindingChanges({
          tx,
          organizationId,
          teamId: input.teamId,
          plan,
        });

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
      await assertCreateAllowsCustomRoleMembers({
        members: input.members,
        organizationId: input.organizationId,
        actorUser: ctx.session.user,
      });

      const prisma = ctx.prisma;

      const teamNanoId = nanoid();
      const teamId = `team_${teamNanoId}`;
      const teamSlug =
        slugify(input.name, { lower: true, strict: true }) +
        "-" +
        teamNanoId.substring(0, 6);

      await assertUsersInOrganization(
        prisma,
        input.organizationId,
        input.members.map((member) => member.userId),
      );

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
          await createMemberBindingForNewTeam({
            tx,
            organizationId: input.organizationId,
            team,
            member,
          });
        }

        // Post-creation validation: ensure we have at least one admin (direct user or group binding)
        await assertNewTeamHasAdmin({
          tx,
          organizationId: input.organizationId,
          teamId: team.id,
        });

        return team;
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
      const service = new TeamService(ctx.prisma);
      return service.removeMember({
        teamId: input.teamId,
        userId: input.userId,
        currentUserId: ctx.session.user.id,
      });
    }),
});
