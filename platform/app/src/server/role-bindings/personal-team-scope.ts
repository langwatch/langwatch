import {
  type Prisma,
  type PrismaClient,
  RoleBindingScopeType,
} from "~/generated/prisma/client";

import { PersonalWorkspaceNotManagedHereError } from "~/server/app-layer/teams/team.service";

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
  const idsOfType = (scopeType: RoleBindingScopeType) => [
    ...new Set(
      scopes
        .filter((scope) => scope.scopeType === scopeType)
        .map((scope) => scope.scopeId),
    ),
  ];

  const teamIds = idsOfType(RoleBindingScopeType.TEAM);
  if (teamIds.length > 0) {
    const personalTeam = await client.team.findFirst({
      where: { id: { in: teamIds }, isPersonal: true },
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
      },
      select: { team: { select: { name: true } } },
    });
    if (personalProject) return personalProject.team;
  }

  return null;
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
