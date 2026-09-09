import { RoleBindingScopeType } from "@langwatch/organization-contract";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

export type PersonalTeamScopeClient = PrismaClient | Prisma.TransactionClient;

export interface RoleBindingScope {
  scopeType: RoleBindingScopeType;
  scopeId: string;
}

/** Every read that decides whether a scope reaches somebody's private workspace. */
export class PrismaPersonalTeamScopeRepository {
  static create(): PrismaPersonalTeamScopeRepository {
    return new PrismaPersonalTeamScopeRepository();
  }

  private constructor() {}

  /**
   * The teams an organization actually shares, which is every team except the personal
   * workspace each member gets to themselves.
   */
  async findSharedTeamIds({
    client,
    organizationId,
  }: {
    client: PersonalTeamScopeClient;
    organizationId: string;
  }): Promise<string[]> {
    const teams = await client.team.findMany({
      where: { organizationId, isPersonal: false },
      select: { id: true },
    });

    return teams.map((team) => team.id);
  }

  /**
   * The personal team a set of scopes reaches, by the name its owner sees, or null when they
   * reach only shared ground. Both TEAM and PROJECT scopes are resolved, so naming the project
   * rather than the team cannot be the way around the refusal.
   */
  async tryFindPersonalTeamInScopes({
    client,
    scopes,
  }: {
    client: PersonalTeamScopeClient;
    scopes: RoleBindingScope[];
  }): Promise<{ name: string } | null> {
    return this.findPersonalTeamMatching({ client, scopes, teamWhere: {} });
  }

  /**
   * The personal team a set of scopes reaches that does NOT belong to the given
   * user, or null. `null` owns no personal workspace, so every personal scope
   * matches.
   */
  async tryFindForeignPersonalTeamInScopes({
    client,
    scopes,
    ownerUserId,
  }: {
    client: PersonalTeamScopeClient;
    scopes: RoleBindingScope[];
    ownerUserId: string | null;
  }): Promise<{ name: string } | null> {
    return this.findPersonalTeamMatching({
      client,
      scopes,
      teamWhere: this.foreignOwnerFilter(ownerUserId),
    });
  }

  private async findPersonalTeamMatching({
    client,
    scopes,
    teamWhere,
  }: {
    client: PersonalTeamScopeClient;
    scopes: RoleBindingScope[];
    teamWhere: Prisma.TeamWhereInput;
  }): Promise<{ name: string } | null> {
    const idsOfType = (scopeType: RoleBindingScopeType) => [
      ...new Set(
        scopes.filter((scope) => scope.scopeType === scopeType).map((scope) => scope.scopeId),
      ),
    ];

    const teamIds = idsOfType(RoleBindingScopeType.TEAM);
    if (teamIds.length > 0) {
      const personalTeam = await client.team.findFirst({
        where: { id: { in: teamIds }, isPersonal: true, AND: [teamWhere] },
        select: { name: true },
      });
      if (personalTeam) {
        return personalTeam;
      }
    }

    // A project-scoped binding on the personal project reaches the same private
    // space the team-scoped one does, so naming the project rather than the team
    // cannot be the way around this.
    const projectIds = idsOfType(RoleBindingScopeType.PROJECT);
    if (projectIds.length > 0) {
      const personalProject = await client.project.findFirst({
        where: {
          id: { in: projectIds },
          OR: [{ isPersonal: true }, { team: { isPersonal: true } }],
          team: { AND: [teamWhere] },
        },
        select: { team: { select: { name: true } } },
      });
      if (personalProject) {
        return personalProject.team;
      }
    }

    return null;
  }

  /**
   * A team filter matching personal teams that do NOT belong to the given user.
   */
  private foreignOwnerFilter(ownerUserId: string | null): Prisma.TeamWhereInput {
    return ownerUserId
      ? { OR: [{ ownerUserId: null }, { ownerUserId: { not: ownerUserId } }] }
      : {};
  }
}
