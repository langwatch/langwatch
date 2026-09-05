import { RoleBindingScopeType } from "@langwatch/organization-contract";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

export type PersonalTeamScopeClient = PrismaClient | Prisma.TransactionClient;

export interface RoleBindingScope {
  scopeType: RoleBindingScopeType;
  scopeId: string;
}

/**
 * The teams an organization actually shares, which is every team except the
 * personal workspace each member gets to themselves.
 *
 * Anything deciding what an organization-wide change applies to asks for this
 * rather than for `team.findMany` by organization: a personal workspace has
 * exactly one admin, its owner, so sweeping it into such a change asks the
 * organization to demote a team's last admin, which is refused.
 */
export async function findSharedTeamIds({
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
 * The personal team a set of scopes reaches, by the name its owner sees, or
 * null when they reach only shared ground. Both TEAM and PROJECT scopes are
 * resolved, so naming the project rather than the team cannot be the way
 * around the refusal.
 */
export async function tryFindPersonalTeamInScopes({
  client,
  scopes,
}: {
  client: PersonalTeamScopeClient;
  scopes: RoleBindingScope[];
}): Promise<{ name: string } | null> {
  return findPersonalTeamMatching({ client, scopes, teamWhere: {} });
}

/**
 * The personal team a set of scopes reaches that does NOT belong to the given
 * user, or null. `null` owns no personal workspace, so every personal scope
 * matches.
 */
export async function tryFindForeignPersonalTeamInScopes({
  client,
  scopes,
  ownerUserId,
}: {
  client: PersonalTeamScopeClient;
  scopes: RoleBindingScope[];
  ownerUserId: string | null;
}): Promise<{ name: string } | null> {
  return findPersonalTeamMatching({ client, scopes, teamWhere: foreignOwnerFilter(ownerUserId) });
}

async function findPersonalTeamMatching({
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
 * A personal team with no recorded owner also matches, so the check fails
 * closed on incomplete provisioning: the explicit `ownerUserId: null` arm
 * matters because Prisma's `not` comparison would otherwise skip NULL rows.
 */
function foreignOwnerFilter(ownerUserId: string | null): Prisma.TeamWhereInput {
  return ownerUserId ? { OR: [{ ownerUserId: null }, { ownerUserId: { not: ownerUserId } }] } : {};
}
