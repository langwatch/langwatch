// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** What one owner member fact did to a membership. */
export type NurturingMembershipChange = "joined" | "left" | "returned";

/**
 * One person's membership of one organization as nurturing copied it from the owners' member
 * facts: the latest time of each change, epoch ms, null until one is seen.
 */
export type NurturingMembership = Readonly<{
  organizationId: string;
  userId: string;
  joinedAt: number | null;
  leftAt: number | null;
  returnedAt: number | null;
}>;

/** Current when its latest join or return is after its latest leave; a join must have been seen. */
export function isCurrentMembership(membership: NurturingMembership): boolean {
  const { joinedAt, leftAt, returnedAt } = membership;
  if (joinedAt === null) return false;
  return leftAt === null || Math.max(joinedAt, returnedAt ?? joinedAt) > leftAt;
}

/**
 * The members of `organizationId` whose current membership with the latest join is this one
 * (ties by organization id): its traits are theirs. `memberships` holds every membership of the
 * organization's members.
 */
export function membersWhoseLatestOrganizationIs({
  memberships,
  organizationId,
}: Readonly<{
  memberships: readonly NurturingMembership[];
  organizationId: string;
}>): string[] {
  const latest = new Map<string, NurturingMembership>();
  for (const membership of memberships.filter(isCurrentMembership)) {
    const known = latest.get(membership.userId);
    const later =
      !known ||
      (membership.joinedAt ?? 0) > (known.joinedAt ?? 0) ||
      (membership.joinedAt === known.joinedAt && membership.organizationId < known.organizationId);
    if (later) latest.set(membership.userId, membership);
  }
  return [...latest.values()]
    .filter((membership) => membership.organizationId === organizationId)
    .map(({ userId }) => userId);
}
