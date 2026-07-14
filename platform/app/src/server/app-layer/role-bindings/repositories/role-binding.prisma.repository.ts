import { RoleBindingScopeType, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type {
  RoleBindingForSynthesis,
  RoleBindingRepository,
  TeamScopedMemberBinding,
} from "./role-binding.repository";

export class PrismaRoleBindingRepository implements RoleBindingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listForOrganizationsAndUser({
    orgIds,
    userId,
  }: {
    orgIds: string[];
    userId: string;
  }): Promise<RoleBindingForSynthesis[]> {
    return this.prisma.roleBinding.findMany({
      where: {
        organizationId: { in: orgIds },
        OR: [
          { userId },
          { group: { members: { some: { userId } } } },
        ],
        scopeType: {
          in: [
            RoleBindingScopeType.TEAM,
            RoleBindingScopeType.ORGANIZATION,
            RoleBindingScopeType.PROJECT,
          ],
        },
      },
      select: {
        organizationId: true,
        scopeType: true,
        scopeId: true,
        role: true,
        customRoleId: true,
        customRole: {
          select: {
            id: true,
            name: true,
            description: true,
            permissions: true,
            organizationId: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  async listTeamScopedUserBindingsByTeamIds({
    organizationId,
    teamIds,
  }: {
    organizationId: string;
    teamIds: string[];
  }): Promise<Map<string, TeamScopedMemberBinding[]>> {
    // Pre-seed every requested teamId so the caller can rely on a hit even for
    // teams with no members, and so a single query covers all teams (no N+1).
    const byTeam = new Map<string, TeamScopedMemberBinding[]>(
      teamIds.map((teamId) => [teamId, []]),
    );
    if (teamIds.length === 0) return byTeam;

    const bindings = await this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: { in: teamIds },
        userId: { not: null },
      },
      include: { user: true, customRole: true },
    });

    for (const binding of bindings) {
      // The query filters userId non-null and includes user, but Prisma's types
      // don't narrow — skip defensively rather than assert, so a future change
      // to the where/include can't silently produce undefined fields.
      if (!binding.userId || !binding.user) continue;
      byTeam.get(binding.scopeId)?.push({
        userId: binding.userId,
        role: binding.role,
        customRoleId: binding.customRoleId,
        createdAt: binding.createdAt,
        updatedAt: binding.updatedAt,
        user: binding.user,
        customRole: binding.customRole,
      });
    }

    return byTeam;
  }

  async validateScopeInOrg({
    organizationId,
    scopeType,
    scopeId,
  }: {
    organizationId: string;
    scopeType: RoleBindingScopeType;
    scopeId: string;
  }): Promise<void> {
    if (scopeType === RoleBindingScopeType.ORGANIZATION) {
      if (scopeId !== organizationId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid org scope" });
      }
      return;
    }

    if (scopeType === RoleBindingScopeType.TEAM) {
      const team = await this.prisma.team.findFirst({
        where: { id: scopeId, organizationId },
      });
      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found in this org" });
      }
      return;
    }

    if (scopeType === RoleBindingScopeType.PROJECT) {
      const project = await this.prisma.project.findFirst({
        where: { id: scopeId },
        include: { team: { select: { organizationId: true } } },
      });
      if (!project || project.team.organizationId !== organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found in this org" });
      }
    }
  }
}
