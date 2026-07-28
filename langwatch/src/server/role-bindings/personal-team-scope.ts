import {
  type Prisma,
  type PrismaClient,
  RoleBindingScopeType,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";

import {
  PERSONAL_TEAM_MEMBERSHIP_REFUSAL,
  PersonalTeamProtectedError,
} from "~/server/app-layer/teams/team.service";

type Client = PrismaClient | Prisma.TransactionClient;

export interface RoleBindingScope {
  scopeType: RoleBindingScopeType;
  scopeId: string;
}

/**
 * Refuse any role-binding write that would change who reaches a personal team.
 *
 * A personal team holds exactly one member, its owner, and plan-limit counting
 * exempts it on that basis. Granting a second user or a group access leaves the
 * team flagged personal while it is shared in every way that matters, so
 * `getTeamCount` keeps excluding a team the organization is really using. A
 * group ADMIN binding also defeats the last-admin projection that is the only
 * thing stopping the owner from being removed from their own workspace.
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
 */
export async function scopesTouchPersonalTeam(
  client: Client,
  scopes: RoleBindingScope[],
): Promise<boolean> {
  const teamIds = [
    ...new Set(
      scopes
        .filter((scope) => scope.scopeType === RoleBindingScopeType.TEAM)
        .map((scope) => scope.scopeId),
    ),
  ];
  if (teamIds.length === 0) return false;

  const personalTeam = await client.team.findFirst({
    where: { id: { in: teamIds }, isPersonal: true },
    select: { id: true },
  });
  return !!personalTeam;
}

/** tRPC entry points: refuses with FORBIDDEN. */
export async function assertNoPersonalTeamScope(
  client: Client,
  scopes: RoleBindingScope[],
): Promise<void> {
  if (await scopesTouchPersonalTeam(client, scopes)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: PERSONAL_TEAM_MEMBERSHIP_REFUSAL,
    });
  }
}

/**
 * App-layer and REST entry points, which map their own domain errors to HTTP
 * status codes and must not be handed a tRPC error.
 */
export async function assertNoPersonalTeamScopeInService(
  client: Client,
  scopes: RoleBindingScope[],
): Promise<void> {
  if (await scopesTouchPersonalTeam(client, scopes)) {
    throw new PersonalTeamProtectedError(PERSONAL_TEAM_MEMBERSHIP_REFUSAL);
  }
}
