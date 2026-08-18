import { NotFoundError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import {
  Prisma,
  type PrismaClient,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
} from "~/generated/prisma/client";
import { isCustomRole } from "~/server/api/enterprise";
import { grantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import { PrismaRoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.prisma.repository";
import type {
  RoleBindingRepository,
  TeamScopedMemberBinding,
} from "~/server/app-layer/role-bindings/repositories/role-binding.repository";
import {
  CannotRemoveSelfAsLastAdminError,
  PERSONAL_TEAM_MEMBERSHIP_REFUSAL,
  PersonalWorkspaceNotManagedHereError,
  TeamLastAdminRequiredError,
} from "~/server/app-layer/teams/team.service";
import { assertUsersInOrganization } from "~/server/organizations/assertUsersInOrganization";
import {
  computeEffectiveAdminUserIds,
  projectAdminUserIdsAfterDirectEdit,
  projectAdminUserIdsWithoutDirectRole,
} from "~/server/teams/effective-team-admins";
import { KSUID_RESOURCES } from "~/utils/constants";
import { slugify } from "~/utils/slugify";

// When a user holds multiple bindings on one team, the most privileged is the
// one the settings page displays (and the binding team.update edits).
export const TEAM_ROLE_PRIORITY: Record<TeamUserRole, number> = {
  [TeamUserRole.ADMIN]: 0,
  [TeamUserRole.MEMBER]: 1,
  [TeamUserRole.VIEWER]: 2,
  [TeamUserRole.CUSTOM]: 3,
};

/** The user fields every team-member projection selects (kept in one place so
 * the shape can't drift across the three role-binding include sites). */
const MEMBER_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const satisfies Prisma.UserSelect;

const principalInOrganizationWhere = (
  organizationId: string,
): Prisma.RoleBindingWhereInput => ({
  OR: [
    {
      userId: { not: null },
      user: { orgMemberships: { some: { organizationId } } },
    },
    { groupId: { not: null }, group: { organizationId } },
    { apiKeyId: { not: null }, apiKey: { organizationId } },
  ],
});

// Ascending, nulls last — matches Postgres `ORDER BY col ASC` (the ordering the
// previous Prisma `orderBy` produced before members were resolved in memory).
function compareNullsLast(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

export class TeamService {
  constructor(
    private readonly prisma: PrismaClient,
    // Constructed once and reused across reads; the default keeps existing
    // `new TeamService(prisma)` call sites working while allowing injection.
    private readonly roleBindingRepo: RoleBindingRepository = new PrismaRoleBindingRepository(
      prisma,
    ),
  ) {}

  /**
   * Shape TEAM-scoped RoleBindings into the legacy `team.members` (TeamUser)
   * form so callers render members the same way regardless of when membership
   * was created.
   *
   * RoleBindings are the authoritative membership source since migration
   * 20260407120000_migrate_team_users_to_role_bindings (which backfilled
   * existing TeamUser rows and stopped dual-writing to them). Reading the
   * legacy TeamUser relation omitted anyone added after the migration.
   *
   * A user can hold more than one TEAM binding on the same team (the partial
   * unique indexes allow a built-in role plus a custom role at one scope), so
   * we collapse to one row per user keeping the highest-privilege binding —
   * the settings page renders (and its save mutation keys) one row per user.
   */
  private shapeTeamMembers(
    bindings: TeamScopedMemberBinding[],
    teamId: string,
  ) {
    const byUser = new Map<string, TeamScopedMemberBinding>();
    for (const binding of bindings) {
      const existing = byUser.get(binding.userId);
      if (
        !existing ||
        TEAM_ROLE_PRIORITY[binding.role] < TEAM_ROLE_PRIORITY[existing.role]
      ) {
        byUser.set(binding.userId, binding);
      }
    }

    return [...byUser.values()]
      .map((binding) => ({
        userId: binding.userId,
        teamId,
        role: binding.role,
        assignedRoleId: binding.customRoleId,
        assignedRole: binding.customRole,
        createdAt: binding.createdAt,
        updatedAt: binding.updatedAt,
        user: binding.user,
      }))
      .sort((a, b) => {
        const nameCmp = compareNullsLast(a.user.name, b.user.name);
        if (nameCmp !== 0) return nameCmp;
        const emailCmp = compareNullsLast(a.user.email, b.user.email);
        if (emailCmp !== 0) return emailCmp;
        return a.userId.localeCompare(b.userId);
      });
  }

  /**
   * A single team (by slug) plus its projects and members, for the
   * team-settings page. Returns `null` when no team matches; the caller maps
   * null to NOT_FOUND and applies email-privacy redaction (request-scoped).
   */
  async getTeamWithMembers({
    slug,
    organizationId,
  }: {
    slug: string;
    organizationId: string;
  }) {
    const team = await this.prisma.team.findFirst({
      where: { slug, organizationId },
      include: {
        projects: {
          where: {
            archivedAt: null,
            kind: { not: "internal_governance" },
          },
        },
      },
    });

    if (!team) return null;

    const byTeam =
      await this.roleBindingRepo.listTeamScopedUserBindingsByTeamIds({
        organizationId,
        teamIds: [team.id],
      });

    return {
      ...team,
      members: this.shapeTeamMembers(byTeam.get(team.id) ?? [], team.id),
    };
  }

  /**
   * All non-archived teams in an org, each with projects + members, for member
   * pickers / drawers / onboarding. `callerHasManage` controls the personal-
   * workspace privacy floor (non-admins never see others' personal teams).
   * Email redaction stays in the caller since it's request-scoped.
   */
  async getTeamsWithMembers({
    organizationId,
    callerId,
    callerHasManage,
  }: {
    organizationId: string;
    callerId: string;
    callerHasManage: boolean;
  }) {
    const teams = await this.prisma.team.findMany({
      where: {
        organizationId,
        archivedAt: null,
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
        projects: {
          where: {
            archivedAt: null,
            kind: { not: "internal_governance" },
          },
        },
      },
    });

    // Single binding query for all teams (no N+1), grouped by teamId.
    const byTeam =
      await this.roleBindingRepo.listTeamScopedUserBindingsByTeamIds({
        organizationId,
        teamIds: teams.map((team) => team.id),
      });

    return teams.map((team) => ({
      ...team,
      members: this.shapeTeamMembers(byTeam.get(team.id) ?? [], team.id),
    }));
  }

  /**
   * A team looked up by slug, returned only if the user is a direct member —
   * membership resolved from TEAM-scoped RoleBindings (not the legacy TeamUser
   * relation, which post-migration members are absent from). Returns `null`
   * when the team doesn't exist or the user isn't a member.
   */
  async getTeamBySlugForUser({
    slug,
    organizationId,
    userId,
  }: {
    slug: string;
    organizationId: string;
    userId: string;
  }) {
    const team = await this.prisma.team.findFirst({
      where: { slug, organizationId },
    });

    if (!team) return null;

    const byTeam =
      await this.roleBindingRepo.listTeamScopedUserBindingsByTeamIds({
        organizationId,
        teamIds: [team.id],
      });

    const isMember = (byTeam.get(team.id) ?? []).some(
      (binding) => binding.userId === userId,
    );
    return isMember ? team : null;
  }

  async getTeamsWithRoleBindings({
    organizationId,
  }: {
    organizationId: string;
  }) {
    const teams = await this.prisma.team.findMany({
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
          this.prisma.roleBinding.findMany({
            where: {
              organizationId,
              scopeType: RoleBindingScopeType.TEAM,
              scopeId: team.id,
              ...principalInOrganizationWhere(organizationId),
            },
            include: {
              user: { select: MEMBER_USER_SELECT },
              group: { select: { id: true, name: true, scimSource: true } },
              apiKey: { select: { id: true, name: true } },
              customRole: { select: { id: true, name: true } },
            },
          }),
          projectIds.length > 0
            ? this.prisma.roleBinding.findMany({
                where: {
                  organizationId,
                  scopeType: RoleBindingScopeType.PROJECT,
                  scopeId: { in: projectIds },
                  ...principalInOrganizationWhere(organizationId),
                },
                include: {
                  user: { select: MEMBER_USER_SELECT },
                  group: { select: { id: true, name: true, scimSource: true } },
                  apiKey: { select: { id: true, name: true } },
                  customRole: { select: { id: true, name: true } },
                },
              })
            : [],
        ]);

        // ── Expand group memberships for every group referenced by any
        // binding touching this team. We fetch memberships for project-level
        // group bindings too because they're needed to decide which inherited
        // (team-level group-expanded) entries to filter out as overridden on
        // each project. ──
        const groupBindings = teamBindings.filter((b) => b.groupId);
        const projectGroupBindings = projectBindings.filter((b) => b.groupId);
        const allGroupIds = Array.from(
          new Set([
            ...groupBindings.map((b) => b.groupId!),
            ...projectGroupBindings.map((b) => b.groupId!),
          ]),
        );
        const groupMemberships =
          allGroupIds.length > 0
            ? await this.prisma.groupMembership.findMany({
                where: {
                  groupId: { in: allGroupIds },
                  group: { organizationId },
                  user: { orgMemberships: { some: { organizationId } } },
                },
                include: { user: { select: MEMBER_USER_SELECT } },
              })
            : [];

        // ── Build directMembers: direct users + expanded group members ──
        const directUserBindings = teamBindings.filter((b) => b.userId);
        const directUserIds = new Set(directUserBindings.map((b) => b.userId!));

        // When a user belongs to multiple team-bound groups, keep only the
        // highest-privilege entry. Order: ADMIN > MEMBER > VIEWER > CUSTOM.
        const rolePriority: Record<TeamUserRole, number> = {
          [TeamUserRole.ADMIN]: 0,
          [TeamUserRole.MEMBER]: 1,
          [TeamUserRole.VIEWER]: 2,
          [TeamUserRole.CUSTOM]: 3,
        };
        const sortedGroupBindings = [...groupBindings].sort(
          (a, b) => rolePriority[a.role] - rolePriority[b.role],
        );

        const seenExpandedUserIds = new Set<string>();
        const expandedGroupMembers = sortedGroupBindings.flatMap((b) =>
          groupMemberships
            .filter((gm) => gm.groupId === b.groupId)
            .filter((gm) => {
              if (directUserIds.has(gm.userId)) return false; // direct binding takes priority
              if (seenExpandedUserIds.has(gm.userId)) return false;
              seenExpandedUserIds.add(gm.userId);
              return true;
            })
            .map((gm) => ({
              bindingId: null as string | null,
              userId: gm.userId,
              groupId: b.groupId,
              viaGroupId: b.groupId!,
              viaGroupName: b.group?.name ?? null,
              name: gm.user.name ?? gm.user.email ?? "Unknown",
              email: gm.user.email ?? null,
              image: gm.user.image ?? null,
              role: b.role,
              customRoleId: b.customRoleId,
              customRoleName: b.customRole?.name ?? null,
            })),
        );

        const directMembers = [
          ...directUserBindings.map((b) => ({
            bindingId: b.id as string | null,
            userId: b.userId,
            groupId: null as string | null,
            viaGroupId: null as string | null,
            viaGroupName: null as string | null,
            name: b.user?.name ?? b.user?.email ?? b.apiKey?.name ?? "Unknown",
            email: b.user?.email ?? null,
            image: b.user?.image ?? null,
            role: b.role,
            customRoleId: b.customRoleId,
            customRoleName: b.customRole?.name ?? null,
          })),
          ...expandedGroupMembers,
        ].sort((a, b) => {
          const nameCmp = (a.name ?? "").localeCompare(b.name ?? "");
          if (nameCmp !== 0) return nameCmp;
          const emailCmp = (a.email ?? "").localeCompare(b.email ?? "");
          if (emailCmp !== 0) return emailCmp;
          return (a.userId ?? "").localeCompare(b.userId ?? "");
        });

        // ── Collect userIds that have a team-level binding (direct or via group) ──
        const teamBoundUserIds = new Set(
          directMembers.filter((m) => m.userId).map((m) => m.userId!),
        );

        // ── Build projectOnlyAccess: users with project bindings but NO team binding ──
        const projectOnlyMap = new Map<
          string,
          {
            bindingId: string;
            userId: string;
            name: string;
            email: string | null;
            image: string | null;
            role: TeamUserRole;
            customRoleId: string | null;
            customRoleName: string | null;
            projectId: string;
            projectName: string;
          }
        >();

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
              image: b.user?.image ?? null,
              role: b.role,
              customRoleId: b.customRoleId,
              customRoleName: b.customRole?.name ?? null,
              projectId: project.id,
              projectName: project.name,
            });
          }
        }

        // ── Build per-project access list ──
        const projectAccess: Record<
          string,
          Array<{
            bindingId: string | null;
            userId: string | null;
            groupId: string | null;
            viaGroupName: string | null;
            name: string;
            email: string | null;
            image: string | null;
            role: TeamUserRole;
            customRoleId: string | null;
            customRoleName: string | null;
            source: "team" | "direct" | "override";
            teamRole?: TeamUserRole;
          }>
        > = {};

        for (const proj of team.projects) {
          const inherited = directMembers.map((m) => ({
            bindingId: m.bindingId,
            userId: m.userId,
            groupId: m.groupId,
            viaGroupName: m.viaGroupName,
            name: m.name,
            email: m.email,
            image: m.image,
            role: m.role,
            customRoleId: m.customRoleId,
            customRoleName: m.customRoleName,
            source: "team" as const,
          }));

          const projBindings = projectBindings.filter(
            (b) => b.scopeId === proj.id,
          );

          // Group IDs bound at the team level — used to detect whether a
          // project-level group binding is overriding a team-level one.
          const teamBoundGroupIds = new Set(
            groupBindings.map((b) => b.groupId!),
          );

          const projectLevel = projBindings.map((b) => {
            // A binding "overrides" team access if the same principal
            // (user or group) already has team-level access — direct or
            // group-expanded for users; same group bound at team level for
            // groups.
            const directTeamBinding = teamBindings.find(
              (tb) => tb.userId && tb.userId === b.userId,
            );
            const userInheritsFromTeam =
              !!b.userId && teamBoundUserIds.has(b.userId);
            const groupInheritsFromTeam =
              !!b.groupId && teamBoundGroupIds.has(b.groupId);
            const inheritsFromTeam =
              userInheritsFromTeam || groupInheritsFromTeam;
            return {
              bindingId: b.id,
              userId: b.userId,
              groupId: b.groupId,
              viaGroupName: b.groupId ? (b.group?.name ?? null) : null,
              name:
                b.user?.name ?? b.group?.name ?? b.apiKey?.name ?? "Unknown",
              email: b.user?.email ?? null,
              image: b.user?.image ?? null,
              role: b.role,
              customRoleId: b.customRoleId,
              customRoleName: b.customRole?.name ?? null,
              source: inheritsFromTeam
                ? ("override" as const)
                : ("direct" as const),
              teamRole: directTeamBinding?.role,
            };
          });

          // Remove "inherited" entries that have a project-level override.
          // Project-level group bindings also override the inherited
          // (team-level) group-expanded entries for their members.
          const overriddenUserIds = new Set<string>(
            projBindings.filter((b) => b.userId).map((b) => b.userId!),
          );
          const projGroupIdsOnThisProject = projBindings
            .filter((b) => b.groupId)
            .map((b) => b.groupId!);
          for (const gid of projGroupIdsOnThisProject) {
            for (const gm of groupMemberships) {
              if (gm.groupId === gid) overriddenUserIds.add(gm.userId);
            }
          }
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
  }

  /**
   * The team settings form's save: a rename plus the desired membership.
   *
   * It lived in the tRPC router, which read RoleBinding rows, decided the
   * last-admin question, and drove the grants ledger itself — three things a
   * route is not allowed to do, and none of them reachable from the REST
   * surface that answers for the same team.
   *
   * A user can hold MORE THAN ONE TEAM binding on the same team (the partial
   * unique indexes allow a built-in role plus additive custom-role grants at
   * one scope), and RBAC unions them. This form shows and edits ONLY the
   * displayed membership — the highest-privilege binding (same selection the
   * read path uses, TEAM_ROLE_PRIORITY). So on save we update just that
   * binding and PRESERVE the user's other (additive) bindings; we must not
   * delete them, or a routine autosaved edit would silently revoke
   * custom-role grants. Removing a user from the team is unambiguous, so that
   * path still drops all of their bindings.
   */
  async updateWithMembers({
    teamId,
    name,
    members,
    currentUserId,
  }: {
    teamId: string;
    name: string;
    members: Array<{
      userId: string;
      role: string;
      customRoleId?: string;
    }>;
    currentUserId: string;
  }): Promise<{ success: true }> {
    const teamRecord = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true, isPersonal: true, ownerUserId: true },
    });
    if (!teamRecord) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
    }
    const { organizationId } = teamRecord;

    // A personal team is single-member by definition: its owner holds the one
    // ADMIN binding PersonalWorkspaceService provisions, and plan-limit
    // counting exempts the team on that basis. Members and roles are
    // therefore not editable here. Only submissions that keep the provisioned
    // membership (or touch none at all, e.g. a rename) go through; everything
    // else needs a shared team.
    if (teamRecord.isPersonal) {
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

    await assertUsersInOrganization(
      this.prisma,
      organizationId,
      members.map((member) => member.userId),
    );
    await this.assertCustomRolesBelongToOrganization({
      organizationId,
      members,
    });

    if (members.length === 0) {
      await this.prisma.team.update({ where: { id: teamId }, data: { name } });
      return { success: true };
    }

    const targetRole = (member: { role: string }) =>
      isCustomRole(member.role)
        ? TeamUserRole.CUSTOM
        : (member.role as TeamUserRole);
    const targetCustomRoleId = (member: {
      role: string;
      customRoleId?: string;
    }) => (isCustomRole(member.role) ? (member.customRoleId ?? null) : null);

    // The rename and every read the plan rests on share one transaction, so
    // the plan is decided against a single snapshot and the team row is
    // renamed with it. The grants cannot join: they are ledger facts, so they
    // are emitted after this commits, in the order below.
    const plan = await this.prisma.$transaction(async (tx) => {
      const newMembersMap = new Map(members.map((m) => [m.userId, m]));

      const currentBindings = await tx.roleBinding.findMany({
        where: {
          organizationId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamId,
          userId: { not: null },
        },
        select: { id: true, userId: true, role: true, customRoleId: true },
      });
      const currentBindingsByUser = new Map<string, typeof currentBindings>();
      for (const binding of currentBindings) {
        if (!binding.userId) continue;
        const list = currentBindingsByUser.get(binding.userId) ?? [];
        list.push(binding);
        currentBindingsByUser.set(binding.userId, list);
      }

      // The displayed binding = highest-privilege one, matching the read path.
      const displayedBinding = (bindings: typeof currentBindings) =>
        [...bindings].sort(
          (a, b) => TEAM_ROLE_PRIORITY[a.role] - TEAM_ROLE_PRIORITY[b.role],
        )[0]!;

      const idsToRemove: string[] = [];
      const toUpdate: {
        id: string;
        role: TeamUserRole;
        customRoleId: string | null;
      }[] = [];
      const toCreate: (typeof members)[number][] = [];

      // Drop every binding belonging to a user no longer on the team.
      for (const [userId, bindings] of currentBindingsByUser) {
        if (!newMembersMap.has(userId)) {
          idsToRemove.push(...bindings.map((b) => b.id));
        }
      }

      // For each submitted user: edit only the displayed binding; leave the
      // rest (additive grants) untouched.
      for (const member of members) {
        const existing = currentBindingsByUser.get(member.userId) ?? [];
        const role = targetRole(member);
        const customRoleId = targetCustomRoleId(member);
        if (existing.length === 0) {
          toCreate.push(member);
          continue;
        }
        const displayed = displayedBinding(existing);
        if (
          displayed.role === role &&
          displayed.customRoleId === customRoleId
        ) {
          continue; // displayed binding already matches — nothing to do
        }
        // If the target grant already exists on another binding, updating into
        // it would collide with the partial unique index, so drop the
        // displayed binding instead (the grant is already present).
        const targetAlreadyHeld = existing.some(
          (b) =>
            b.id !== displayed.id &&
            b.role === role &&
            b.customRoleId === customRoleId,
        );
        if (targetAlreadyHeld) {
          idsToRemove.push(displayed.id);
        } else {
          toUpdate.push({ id: displayed.id, role, customRoleId });
        }
      }

      // The direct-admin users the plan leaves behind, read off the plan
      // rather than out of a half-written table.
      const removedIds = new Set(idsToRemove);
      const updatedById = new Map(toUpdate.map((u) => [u.id, u]));
      const directAdminUserIdsAfter = new Set<string>();
      for (const binding of currentBindings) {
        if (removedIds.has(binding.id)) continue;
        const role = updatedById.get(binding.id)?.role ?? binding.role;
        if (role === TeamUserRole.ADMIN && binding.userId) {
          directAdminUserIdsAfter.add(binding.userId);
        }
      }
      for (const member of toCreate) {
        if (targetRole(member) === TeamUserRole.ADMIN) {
          directAdminUserIdsAfter.add(member.userId);
        }
      }

      // The same rule the per-member path enforces: a team-local save cannot
      // take the team's last admin away, whether it demotes them or drops them
      // from the list. "Has an admin" counts group-expanded admins too; this
      // form cannot edit group bindings, so a team a group administers never
      // trips it.
      //
      // What it does NOT do is refuse a save on a team that already has no
      // admin. That is the repair — somebody being promoted back to Admin —
      // and gating it on "did this team have a direct admin to lose" let a
      // half-applied save skip the guard entirely on retry. The question is
      // whether this edit LOSES the last admin, so it is asked against the
      // before-state rather than against the shape of the edit.
      const adminsAfter = await projectAdminUserIdsAfterDirectEdit({
        tx,
        organizationId,
        teamId,
        directAdminUserIdsAfter,
      });
      if (adminsAfter.size === 0) {
        const adminsBefore = await computeEffectiveAdminUserIds({
          tx,
          organizationId,
          teamId,
        });
        if (adminsBefore.size > 0) {
          throw new TeamLastAdminRequiredError(name);
        }
      }

      await tx.team.update({ where: { id: teamId }, data: { name } });

      return { idsToRemove, toUpdate, toCreate };
    });

    const writer = grantsLedgerWriter();
    const actor = { type: "user" as const, id: currentUserId };
    // Grants before revocations, the opposite of the batch corrections
    // elsewhere. A save that dies half-way here leaves the OLD access
    // standing — somebody still on the team who was going to be removed —
    // rather than a team stripped of the admin whose replacement had not been
    // promoted yet. The retry converges, and the guard above lets it.
    if (plan.toCreate.length > 0) {
      await writer.attachBindings({
        organizationId,
        bindings: plan.toCreate.map((member) => ({
          bindingId: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          principal: { userId: member.userId },
          role: targetRole(member),
          customRoleId: targetCustomRoleId(member),
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamId,
        })),
        actor,
        onDuplicate: "skip",
      });
    }
    for (const { id, role, customRoleId } of plan.toUpdate) {
      await writer.changeBindingRole({
        organizationId,
        bindingId: id,
        role,
        customRoleId,
        actor,
      });
    }
    if (plan.idsToRemove.length > 0) {
      await writer.revokeBindings({
        organizationId,
        bindingIds: plan.idsToRemove,
        actor,
      });
    }

    return { success: true };
  }

  /**
   * Create a team with its founding membership.
   *
   * The admin rule is decided on the request rather than counted back out of
   * the table: a team born this second has no group bindings, so its admins
   * are exactly the members named ADMIN here. Nothing is written until every
   * member row and that rule have passed.
   */
  async createWithMembers({
    organizationId,
    name,
    members,
    currentUserId,
  }: {
    organizationId: string;
    name: string;
    members: Array<{ userId: string; role: string; customRoleId?: string }>;
    currentUserId: string;
  }): Promise<Team> {
    const teamNanoId = nanoid();
    const teamId = `team_${teamNanoId}`;
    const teamSlug = `${slugify(name, { lower: true, strict: true })}-${teamNanoId.substring(0, 6)}`;

    await assertUsersInOrganization(
      this.prisma,
      organizationId,
      members.map((member) => member.userId),
    );
    await this.assertCustomRolesBelongToOrganization({
      organizationId,
      members,
      // The creation path has always named an invalid custom role a bad
      // request rather than a missing one, and says so in one sentence.
      onInvalid: (customRoleId) =>
        new TRPCError({
          code: "BAD_REQUEST",
          message: `Custom role ${customRoleId} is invalid for this team`,
        }),
    });

    const memberBindings = members.map((member) => ({
      bindingId: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      principal: { userId: member.userId },
      role: isCustomRole(member.role)
        ? TeamUserRole.CUSTOM
        : (member.role as TeamUserRole),
      customRoleId: isCustomRole(member.role)
        ? (member.customRoleId ?? null)
        : null,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
    }));

    if (!memberBindings.some((b) => b.role === TeamUserRole.ADMIN)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Team must have at least one admin",
      });
    }

    const team = await this.prisma.team.create({
      data: { id: teamId, name, slug: teamSlug, organizationId },
    });

    await grantsLedgerWriter().attachBindings({
      organizationId,
      bindings: memberBindings,
      actor: { type: "user", id: currentUserId },
      onDuplicate: "skip",
    });

    return team;
  }

  /**
   * Create a team whose only member is the person creating it, as its admin.
   *
   * The project-creation flow makes one of these when somebody names a new
   * team instead of picking an existing one: the team row is not a grant, the
   * ADMIN binding is, and the binding follows the row so a crash between them
   * leaves a team its creator cannot administer rather than a grant pointing
   * at nothing.
   */
  async createWithFoundingAdmin({
    organizationId,
    name,
    adminUserId,
  }: {
    organizationId: string;
    name: string;
    adminUserId: string;
  }): Promise<Team> {
    const teamNanoId = nanoid();
    const teamId = `team_${teamNanoId}`;
    const teamSlug = `${slugify(name, { lower: true, strict: true })}-${teamId.substring(0, 6)}`;

    const team = await this.prisma.team.create({
      data: { id: teamId, name, slug: teamSlug, organizationId },
    });

    await grantsLedgerWriter().attachBindings({
      organizationId,
      bindings: [
        {
          bindingId: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          principal: { userId: adminUserId },
          role: TeamUserRole.ADMIN,
          customRoleId: null,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: team.id,
        },
      ],
      actor: { type: "user", id: adminUserId },
      onDuplicate: "skip",
    });

    return team;
  }

  /**
   * Every custom role a submitted membership names has to be a user-created
   * role of this organization: the resolver grants whatever the role says, so
   * a binding pointing at another organization's role would reach across the
   * tenant boundary, and one pointing at an API key's private role would hand
   * a person a credential's permissions.
   */
  private async assertCustomRolesBelongToOrganization({
    organizationId,
    members,
    onInvalid,
  }: {
    organizationId: string;
    members: Array<{ userId: string; role: string; customRoleId?: string }>;
    /** How this surface names a role that is not this organization's to grant. */
    onInvalid?: (customRoleId: string) => Error;
  }): Promise<void> {
    for (const member of members.filter((m) => isCustomRole(m.role))) {
      if (!member.customRoleId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `customRoleId is required when role is a custom role for user ${member.userId}`,
        });
      }
      const customRoleId = member.customRoleId;
      const customRole = await this.prisma.customRole.findUnique({
        where: { id: customRoleId },
        select: { organizationId: true, kind: true },
      });
      if (customRole?.kind !== "custom") {
        throw (
          onInvalid?.(customRoleId) ??
          new TRPCError({
            code: "NOT_FOUND",
            message: `Custom role ${customRoleId} not found`,
          })
        );
      }
      if (customRole.organizationId !== organizationId) {
        throw (
          onInvalid?.(customRoleId) ??
          new TRPCError({
            code: "FORBIDDEN",
            message: `Custom role ${customRoleId} does not belong to team's organization`,
          })
        );
      }
    }
  }

  async removeMember({
    teamId,
    userId,
    currentUserId,
  }: {
    teamId: string;
    userId: string;
    currentUserId: string;
  }) {
    const removal = await this.prisma.$transaction(
      async (tx) => {
        // Validate that the team exists
        const team = await tx.team.findUnique({
          where: { id: teamId },
          select: {
            id: true,
            name: true,
            organizationId: true,
            isPersonal: true,
          },
        });

        if (!team) {
          throw new NotFoundError("team_not_found", "Team", teamId);
        }

        // The one member of a personal team is its owner, and the last-admin
        // projection below stops protecting them the moment a group binding
        // exists on the team, so the invariant is stated here directly.
        if (team.isPersonal) {
          throw new PersonalWorkspaceNotManagedHereError(team.name);
        }

        const effectiveAdminUserIds = await computeEffectiveAdminUserIds({
          tx,
          organizationId: team.organizationId,
          teamId,
        });

        if (effectiveAdminUserIds.size === 0) {
          throw new TeamLastAdminRequiredError(team.name);
        }

        // Check if the target user is currently a direct member of the team
        const targetBinding = await tx.roleBinding.findFirst({
          where: {
            organizationId: team.organizationId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
            userId,
          },
          select: { role: true },
        });

        if (!targetBinding) {
          throw new NotFoundError(
            "team_membership_not_found",
            "TeamMember",
            userId,
          );
        }

        const projectedAdminUserIds =
          await projectAdminUserIdsWithoutDirectRole({
            tx,
            organizationId: team.organizationId,
            teamId,
            userId,
          });

        if (projectedAdminUserIds.size === 0) {
          if (userId === currentUserId) {
            throw new CannotRemoveSelfAsLastAdminError(team.name);
          }

          throw new TeamLastAdminRequiredError(team.name);
        }

        // The legacy TeamUser row is a membership row, not a grant, so it
        // stays imperative here. The team-scoped grants this member holds are
        // ledger facts: their ids are collected under the same serializable
        // read and revoked as a command once this commits. There is no
        // post-removal re-read of the admin set — `projectedAdminUserIds`
        // above IS that post-state, computed for exactly this removal.
        const grantIds = await tx.roleBinding.findMany({
          where: {
            organizationId: team.organizationId,
            userId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
          },
          select: { id: true },
        });
        await tx.teamUser.deleteMany({ where: { userId, teamId } });

        await this.serializeAgainstConcurrentMembershipChanges({ tx, teamId });

        return {
          organizationId: team.organizationId,
          bindingIds: grantIds.map((row) => row.id),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await grantsLedgerWriter().revokeBindings({
      organizationId: removal.organizationId,
      bindingIds: removal.bindingIds,
      actor: { type: "user", id: currentUserId },
      reason: "removed from team",
    });

    return { success: true, removedUserId: userId };
  }

  /**
   * What makes two simultaneous membership changes on one team conflict.
   *
   * Serializable is not enough on its own: the removal reads the team's admin
   * bindings and writes only its own TeamUser row, so two removals aimed at
   * the LAST TWO admins touch nothing in common — each counts two admins,
   * each deletes a different membership row, and both commit, leaving a team
   * nobody administers. Deleting the binding rows in there is what used to
   * make them collide, and the ledger is their only writer now. So the team
   * row carries the conflict instead: every removal writes it, the second of
   * two racing removals finds it changed under its snapshot, and Postgres
   * refuses that one (40001) rather than letting both through.
   */
  private async serializeAgainstConcurrentMembershipChanges({
    tx,
    teamId,
  }: {
    tx: Prisma.TransactionClient;
    teamId: string;
  }): Promise<void> {
    await tx.team.update({
      where: { id: teamId },
      data: { updatedAt: new Date() },
    });
  }
}
