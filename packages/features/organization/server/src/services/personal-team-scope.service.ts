import {
  type Prisma,
  type PrismaClient,
  RoleBindingScopeType,
} from "@langwatch/prisma-client/generated";

import { PersonalWorkspaceNotManagedHereError } from "@langwatch/organization-contract";

type Client = PrismaClient | Prisma.TransactionClient;

export interface RoleBindingScope {
  scopeType: RoleBindingScopeType;
  scopeId: string;
}
/**
 * The teams an organization actually shares, which is every team except the
 * personal workspace each member gets to themselves.
 *
 * The counterpart to the refusal below, and here beside it so the two sides of
 * the same invariant cannot drift. Anything deciding what an organization-wide
 * change applies to asks for this rather than for `team.findMany` by
 * organization: a personal workspace has exactly one admin, its owner, so
 * sweeping it into such a change asks the organization to demote a team's last
 * admin, which is refused, and the refusal takes the whole change down with it.
 */
export async function findSharedTeamIds({
  client,
  organizationId,
}: {
  client: Client;
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
 * null when they reach only shared ground.
 *
 * Both TEAM and PROJECT scopes are resolved, since a binding on the personal
 * project reaches the same private space as one on the personal team, so naming
 * the project rather than the team cannot be the way around the refusal.
 */
export async function findPersonalTeamInScopes({
  client,
  scopes,
}: {
  client: Client;
  scopes: RoleBindingScope[];
}): Promise<{ name: string } | null> {
  return findPersonalTeamMatching({ client, scopes, teamWhere: {} });
}

async function findPersonalTeamMatching({
  client,
  scopes,
  teamWhere,
}: {
  client: Client;
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
    if (personalTeam) return personalTeam;
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
    if (personalProject) return personalProject.team;
  }

  return null;
}

/**
 * A team filter matching personal teams that do NOT belong to the given user.
 * `null` (a credential acting as nobody, e.g. a service key) matches every
 * personal team. A personal team with no recorded owner also matches, so the
 * check fails closed on incomplete provisioning: the explicit `ownerUserId:
 * null` arm matters because Prisma's `not` comparison would otherwise skip
 * NULL rows.
 */
function foreignOwnerFilter(ownerUserId: string | null): Prisma.TeamWhereInput {
  return ownerUserId ? { OR: [{ ownerUserId: null }, { ownerUserId: { not: ownerUserId } }] } : {};
}

export async function scopesTouchPersonalTeam({
  client,
  scopes,
}: {
  client: Client;
  scopes: RoleBindingScope[];
}): Promise<boolean> {
  return (await findPersonalTeamInScopes({ client, scopes })) !== null;
}

/**
 * Refuse any role-binding write that would change who reaches a personal team.
 *
 * A personal team holds exactly one member, its owner. Granting a second user
 * or a group access leaves the team flagged personal while it is shared in
 * every way that matters, so the workspace the owner is promised privacy in
 * is no longer private. A group ADMIN binding also defeats the last-admin
 * projection that is the only thing stopping the owner from being removed
 * from their own workspace.
 *
 * The invariant lives here rather than at each entry point because role
 * bindings are written from the role-binding service, the group router, the
 * member-role path and the team editor, and only some of them share a code
 * path. `PersonalWorkspaceService` provisions the one canonical owner ADMIN
 * binding straight through Prisma, so it never reaches this and provisioning
 * stays unaffected.
 *
 * Pass every scope a write touches, creates and deletes alike: removing the
 * owner's binding is as much a membership change as adding someone else's.
 *
 * Refuses with a handled error, which every boundary reads: tRPC maps its 403
 * to FORBIDDEN and puts the code on the wire for the client to key its copy
 * off, and the app layer hands it on as it is. One shape for one refusal, so no
 * caller has to know which entry point it arrived through.
 *
 * A seat change is not supposed to reach here at all. It asks
 * {@link findSharedTeamIds} which teams it applies to, so the personal
 * workspace is never in the set, and this stays what it was built to be: the
 * line an attempt to *share* a personal workspace runs into.
 */
export async function assertNoPersonalTeamScope({
  client,
  scopes,
}: {
  client: Client;
  scopes: RoleBindingScope[];
}): Promise<void> {
  const personalTeam = await findPersonalTeamInScopes({ client, scopes });
  if (personalTeam) {
    throw new PersonalWorkspaceNotManagedHereError(personalTeam.name);
  }
}

/**
 * Refuse a role-binding write that reaches a personal workspace belonging to
 * anyone but the user the credential acts as.
 *
 * The API-key mint path needs this shape rather than
 * {@link assertNoPersonalTeamScope}: a key OWNED by the workspace's owner is
 * that owner acting programmatically (the Langy session key and a member's
 * own SDK key are both minted against the owner's personal project), so a
 * blanket refusal would take the owner's own workspace away from their own
 * credentials. What must never happen is the workspace admitting a SECOND
 * principal: a service key (owned by nobody) or a key owned by anyone else,
 * which is the escalation the blanket guard exists to stop.
 */
export async function assertPersonalTeamScopesOwnedBy({
  client,
  scopes,
  ownerUserId,
}: {
  client: Client;
  scopes: RoleBindingScope[];
  /**
   * The user the credential acts as. `null` owns no personal workspace, so
   * every personal scope is refused.
   */
  ownerUserId: string | null;
}): Promise<void> {
  const foreignPersonalTeam = await findPersonalTeamMatching({
    client,
    scopes,
    teamWhere: foreignOwnerFilter(ownerUserId),
  });
  if (foreignPersonalTeam) {
    throw new PersonalWorkspaceNotManagedHereError(foreignPersonalTeam.name);
  }
}
