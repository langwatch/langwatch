import { RoleBindingScopeType } from "@langwatch/organization-contract";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

import type { PersonalTeamScopeReader } from "../../services/personal-team-scope.service.ts";

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
   * The personal teams a set of scopes reaches, by the name each owner sees; empty when they
   * reach only shared ground. Both TEAM and PROJECT scopes are resolved, so naming the project
   * rather than the team cannot be the way around the refusal.
   */
  async findPersonalTeamsInScopes({
    client,
    scopes,
  }: {
    client: PersonalTeamScopeClient;
    scopes: RoleBindingScope[];
  }): Promise<{ name: string }[]> {
    return this.findPersonalTeamMatching({ client, scopes, teamWhere: {} });
  }

  /**
   * The personal teams a set of scopes reaches that do NOT belong to the given
   * user. `null` owns no personal workspace, so every personal scope matches.
   */
  async findForeignPersonalTeamsInScopes({
    client,
    scopes,
    ownerUserId,
  }: {
    client: PersonalTeamScopeClient;
    scopes: RoleBindingScope[];
    ownerUserId: string | null;
  }): Promise<{ name: string }[]> {
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
  }): Promise<{ name: string }[]> {
    const idsOfType = (scopeType: RoleBindingScopeType) => [
      ...new Set(
        scopes.filter((scope) => scope.scopeType === scopeType).map((scope) => scope.scopeId),
      ),
    ];

    const reached: { name: string }[] = [];
    const teamIds = idsOfType(RoleBindingScopeType.TEAM);
    if (teamIds.length > 0) {
      const personalTeams = await client.team.findMany({
        where: { id: { in: teamIds }, isPersonal: true, AND: [teamWhere] },
        select: { name: true },
      });
      reached.push(...personalTeams);
    }

    // A project-scoped binding on the personal project reaches the same private
    // space the team-scoped one does, so naming the project rather than the team
    // cannot be the way around this.
    const projectIds = idsOfType(RoleBindingScopeType.PROJECT);
    if (projectIds.length > 0) {
      const personalProjects = await client.project.findMany({
        where: {
          id: { in: projectIds },
          OR: [{ isPersonal: true }, { team: { isPersonal: true } }],
          team: { AND: [teamWhere] },
        },
        select: { team: { select: { name: true } } },
      });
      reached.push(...personalProjects.map((project) => project.team));
    }

    return reached;
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

/**
 * Binds Postgres to the two personal-workspace reads, for a process that
 * wants the narrow {@link PersonalTeamScopeReader} shape without booting the
 * whole organization module. Replaces the deleted `PostgresPersonalTeamScopeAdapter`.
 */
export function bindPersonalTeamScopeReader(database: PrismaClient): PersonalTeamScopeReader {
  const scopes = PrismaPersonalTeamScopeRepository.create();
  return {
    findPersonalTeamsInScopes: (input) =>
      scopes.findPersonalTeamsInScopes({ client: database, ...input }),
    findForeignPersonalTeamsInScopes: (input) =>
      scopes.findForeignPersonalTeamsInScopes({ client: database, ...input }),
  };
}
