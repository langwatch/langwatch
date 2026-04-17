import { Prisma, RoleBindingScopeType, TeamUserRole, type PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "~/server/app-layer/domain-error";

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

        // ── Expand group memberships for group-based team bindings ──
        const groupBindings = teamBindings.filter((b) => b.groupId);
        const groupIds = groupBindings.map((b) => b.groupId!);
        const groupMemberships = groupIds.length > 0
          ? await this.prisma.groupMembership.findMany({
              where: { groupId: { in: groupIds } },
              include: { user: { select: { id: true, name: true, email: true } } },
            })
          : [];

        // ── Build directMembers: direct users + expanded group members ──
        const directUserBindings = teamBindings.filter((b) => b.userId);
        const directUserIds = new Set(directUserBindings.map((b) => b.userId!));

        const expandedGroupMembers = groupBindings.flatMap((b) => {
          const seenInThisExpansion = new Set<string>();
          return groupMemberships
            .filter((gm) => gm.groupId === b.groupId)
            .filter((gm) => {
              if (directUserIds.has(gm.userId)) return false; // direct binding takes priority
              if (seenInThisExpansion.has(gm.userId)) return false;
              seenInThisExpansion.add(gm.userId);
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
            }));
        });

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
        ];

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

          const projectLevel = projBindings.map((b) => {
            // A user "overrides" team access if they have team-level membership
            // via any path — direct or group-expanded. `teamBinding` only finds
            // direct team bindings; `teamBoundUserIds` covers both.
            const directTeamBinding = teamBindings.find(
              (tb) => tb.userId && tb.userId === b.userId,
            );
            const inheritsFromTeam =
              !!b.userId && teamBoundUserIds.has(b.userId);
            return {
              bindingId: b.id,
              userId: b.userId,
              groupId: b.groupId,
              viaGroupName: null as string | null,
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

      // Lock and validate admin count within transaction
      const adminBindings = await tx.roleBinding.findMany({
        where: {
          organizationId: team.organizationId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamId,
          role: TeamUserRole.ADMIN,
          userId: { not: null },
        },
        select: { userId: true },
      });

      const adminCount = adminBindings.length;

      if (adminCount === 0) {
        throw new ValidationError("No admin found for this team");
      }

      // Check if the target user is currently a member
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

      const isTargetUserAdmin = targetBinding.role === TeamUserRole.ADMIN;

      if (adminCount === 1 && isTargetUserAdmin) {
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

      // Post-removal validation: ensure we still have at least one admin
      const finalAdminCount = await tx.roleBinding.count({
        where: {
          organizationId: team.organizationId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamId,
          role: TeamUserRole.ADMIN,
          userId: { not: null },
        },
      });

      if (finalAdminCount === 0) {
        throw new ValidationError("Operation would result in no admins for this team");
      }

      // Return updated team data for client cache invalidation
      const updatedTeam = await tx.team.findUnique({
        where: { id: teamId },
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
        removedUserId: userId,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
