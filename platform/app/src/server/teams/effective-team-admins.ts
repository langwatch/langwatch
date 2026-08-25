import {
  type Prisma,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { liveGroupMemberships } from "~/server/app-layer/authz/repositories/live-rows";

/**
 * Who effectively administers a team.
 *
 * "Has an admin" counts people, not binding rows: every user holding a direct
 * TEAM-scoped ADMIN binding, plus every member of a group holding one, the way
 * SCIM-provisioned organizations grant access. A guard that counts only direct
 * bindings refuses changes the team can absorb, and reads a team administered
 * entirely through a group as having no admin at all. Every last-admin guard
 * resolves the set through here so the policy cannot drift between the team
 * form, the member dialog, and the REST surface.
 */

type TxClient = Prisma.TransactionClient;

/**
 * The principals holding a team's ADMIN bindings, split by kind.
 *
 * The one read every admin question in this module asks — a single
 * definition of "administers this team" that the last-admin invariant rests
 * on every caller agreeing with.
 */
async function readTeamAdminPrincipals({
  tx,
  organizationId,
  teamId,
}: {
  tx: TxClient;
  organizationId: string;
  teamId: string;
}): Promise<{ userIds: string[]; groupIds: string[] }> {
  const adminBindings = await tx.roleBinding.findMany({
    where: {
      organizationId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
      role: TeamUserRole.ADMIN,
    },
    select: { userId: true, groupId: true },
  });

  const userIds: string[] = [];
  const groupIds: string[] = [];
  for (const binding of adminBindings) {
    if (binding.userId) userIds.push(binding.userId);
    if (binding.groupId) groupIds.push(binding.groupId);
  }
  return { userIds, groupIds };
}

/**
 * Every user the given admin-holding groups expand to — the one membership
 * fan-out all the group-derived admin answers share, so the expansion cannot
 * drift between them.
 */
async function groupMemberUserIds({
  tx,
  groupIds,
}: {
  tx: TxClient;
  groupIds: string[];
}): Promise<string[]> {
  if (groupIds.length === 0) return [];
  const memberships = await liveGroupMemberships(tx).findMany({
    where: { groupId: { in: groupIds } },
    select: { userId: true },
  });
  return memberships.map((m) => m.userId);
}

export async function computeEffectiveAdminUserIds({
  tx,
  organizationId,
  teamId,
}: {
  tx: TxClient;
  organizationId: string;
  teamId: string;
}): Promise<Set<string>> {
  const { userIds: directUserIds, groupIds } = await readTeamAdminPrincipals({
    tx,
    organizationId,
    teamId,
  });

  const userIds = new Set<string>(directUserIds);
  for (const id of await groupMemberUserIds({ tx, groupIds })) {
    userIds.add(id);
  }
  return userIds;
}

/**
 * The effective admin set a planned edit to a team's DIRECT user bindings
 * would leave behind.
 *
 * Bindings are ledger facts (ADR-092 §13), so the plan is decided before
 * anything is emitted rather than read back post-write inside a
 * transaction: the caller supplies the direct-admin users its plan leaves,
 * and the group-derived admins — which this form cannot edit — still come
 * from the projection.
 */
export async function projectAdminUserIdsAfterDirectEdit({
  tx,
  organizationId,
  teamId,
  directAdminUserIdsAfter,
}: {
  tx: TxClient;
  organizationId: string;
  teamId: string;
  directAdminUserIdsAfter: Iterable<string>;
}): Promise<Set<string>> {
  const userIds = new Set<string>(directAdminUserIdsAfter);

  const { groupIds } = await readTeamAdminPrincipals({
    tx,
    organizationId,
    teamId,
  });
  for (const id of await groupMemberUserIds({ tx, groupIds })) {
    userIds.add(id);
  }
  return userIds;
}

export async function isUserAdminViaGroup({
  tx,
  organizationId,
  teamId,
  userId,
}: {
  tx: TxClient;
  organizationId: string;
  teamId: string;
  userId: string;
}): Promise<boolean> {
  const { groupIds } = await readTeamAdminPrincipals({
    tx,
    organizationId,
    teamId,
  });
  if (groupIds.length === 0) return false;

  const count = await liveGroupMemberships(tx).count({
    where: { userId, groupId: { in: groupIds } },
  });
  return count > 0;
}

/**
 * The effective admin set once `userId` no longer holds a direct ADMIN binding
 * on the team, whether it is being demoted, converted to a custom role, or
 * removed. Their group-derived administration survives the change, so they
 * only leave the set when no group grants it back.
 */
export async function projectAdminUserIdsWithoutDirectRole({
  tx,
  organizationId,
  teamId,
  userId,
}: {
  tx: TxClient;
  organizationId: string;
  teamId: string;
  userId: string;
}): Promise<Set<string>> {
  const effective = await computeEffectiveAdminUserIds({
    tx,
    organizationId,
    teamId,
  });
  if (!effective.has(userId)) return effective;

  const viaGroup = await isUserAdminViaGroup({
    tx,
    organizationId,
    teamId,
    userId,
  });
  if (!viaGroup) effective.delete(userId);
  return effective;
}
