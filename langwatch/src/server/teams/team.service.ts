import { Prisma, RoleBindingScopeType, TeamUserRole, type PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "~/server/app-layer/domain-error";

type TxClient = Prisma.TransactionClient;

async function computeEffectiveAdminUserIds(
  tx: TxClient,
  organizationId: string,
  teamId: string,
): Promise<Set<string>> {
  const adminBindings = await tx.roleBinding.findMany({
    where: {
      organizationId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
      role: TeamUserRole.ADMIN,
    },
    select: { userId: true, groupId: true },
  });

  const userIds = new Set<string>();
  const groupIds: string[] = [];
  for (const b of adminBindings) {
    if (b.userId) userIds.add(b.userId);
    if (b.groupId) groupIds.push(b.groupId);
  }

  if (groupIds.length > 0) {
    const memberships = await tx.groupMembership.findMany({
      where: { groupId: { in: groupIds } },
      select: { userId: true },
    });
    for (const m of memberships) userIds.add(m.userId);
  }

  return userIds;
}

async function isUserAdminViaGroup(
  tx: TxClient,
  organizationId: string,
  teamId: string,
  userId: string,
): Promise<boolean> {
  const adminGroupBindings = await tx.roleBinding.findMany({
    where: {
      organizationId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
      role: TeamUserRole.ADMIN,
      groupId: { not: null },
    },
    select: { groupId: true },
  });
  if (adminGroupBindings.length === 0) return false;

  const count = await tx.groupMembership.count({
    where: {
      userId,
      groupId: { in: adminGroupBindings.map((b) => b.groupId!) },
    },
  });
  return count > 0;
}

export class TeamService {
  constructor(private readonly prisma: PrismaClient) {}

  async getTeamsWithRoleBindings({ organizationId }: { organizationId: string }) {
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
            },
            include: {
              user: { select: { id: true, name: true, email: true } },
              group: { select: { id: true, name: true, scimSource: true } },
              customRole: { select: { id: true, name: true } },
            },
          }),
          projectIds.length > 0
            ? this.prisma.roleBinding.findMany({
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
        const groupMemberships = allGroupIds.length > 0
          ? await this.prisma.groupMembership.findMany({
              where: { groupId: { in: allGroupIds } },
              include: { user: { select: { id: true, name: true, email: true } } },
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
            name: b.user?.name ?? b.user?.email ?? "Unknown",
            email: b.user?.email ?? null,
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
        const projectOnlyMap = new Map<string, {
          bindingId: string;
          userId: string;
          name: string;
          email: string | null;
          role: TeamUserRole;
          customRoleId: string | null;
          customRoleName: string | null;
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
              customRoleName: b.customRole?.name ?? null,
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
          viaGroupName: string | null;
          name: string;
          email: string | null;
          role: TeamUserRole;
          customRoleId: string | null;
          customRoleName: string | null;
          source: "team" | "direct" | "override";
          teamRole?: TeamUserRole;
        }>> = {};

        for (const proj of team.projects) {
          const inherited = directMembers.map((m) => ({
            bindingId: m.bindingId,
            userId: m.userId,
            groupId: m.groupId,
            viaGroupName: m.viaGroupName,
            name: m.name,
            email: m.email,
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
              viaGroupName: b.groupId ? b.group?.name ?? null : null,
              name: b.user?.name ?? b.group?.name ?? "Unknown",
              email: b.user?.email ?? null,
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

  async removeMember({
    teamId,
    userId,
    currentUserId,
  }: {
    teamId: string;
    userId: string;
    currentUserId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      // Validate that the team exists
      const team = await tx.team.findUnique({
        where: { id: teamId },
        select: { id: true, name: true, organizationId: true },
      });

      if (!team) {
        throw new NotFoundError("team_not_found", "Team", teamId);
      }

      // Compute the effective set of admin userIds — direct user ADMIN
      // bindings plus members of any group with an ADMIN binding on this
      // team. Counting only direct user bindings (as we used to) ignores
      // SCIM/group admins and would incorrectly treat a team with a single
      // direct admin + group-expanded admins as having only one admin.
      const effectiveAdminUserIds = await computeEffectiveAdminUserIds(
        tx,
        team.organizationId,
        teamId,
      );

      if (effectiveAdminUserIds.size === 0) {
        throw new ValidationError("No admin found for this team");
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
        throw new NotFoundError("team_membership_not_found", "TeamMember", userId);
      }

      // Project the post-removal admin set. Removing the target's direct
      // binding only changes things if they aren't also an admin via a
      // group membership on this team.
      const targetStillAdminViaGroup = await isUserAdminViaGroup(
        tx,
        team.organizationId,
        teamId,
        userId,
      );
      const projectedAdminUserIds = new Set(effectiveAdminUserIds);
      if (!targetStillAdminViaGroup) {
        projectedAdminUserIds.delete(userId);
      }

      if (projectedAdminUserIds.size === 0) {
        if (userId === currentUserId) {
          throw new ValidationError("You cannot remove yourself from the last admin position in this team");
        }

        throw new ValidationError("Cannot remove the last admin from this team");
      }

      // Remove RoleBinding and legacy TeamUser row (if any) atomically
      await Promise.all([
        tx.roleBinding.deleteMany({
          where: {
            organizationId: team.organizationId,
            userId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
          },
        }),
        tx.teamUser.deleteMany({
          where: { userId, teamId },
        }),
      ]);

      // Post-removal validation: ensure we still have at least one
      // effective admin (direct or group-expanded).
      const finalAdminUserIds = await computeEffectiveAdminUserIds(
        tx,
        team.organizationId,
        teamId,
      );

      if (finalAdminUserIds.size === 0) {
        throw new ValidationError("Operation would result in no admins for this team");
      }

      return {
        success: true,
        removedUserId: userId,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
