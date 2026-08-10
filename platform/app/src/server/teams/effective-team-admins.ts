import {
  type Prisma,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";

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

export async function computeEffectiveAdminUserIds({
  tx,
  organizationId,
  teamId,
}: {
  tx: TxClient;
  organizationId: string;
  teamId: string;
}): Promise<Set<string>> {
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
