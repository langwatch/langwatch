export type PrismaMigrationMembershipDatabase = {
  user: {
    findUnique(args: {
      where: { id: string };
      select: { orgMemberships: { select: { organizationId: true } } };
    }): Promise<{ orgMemberships: { organizationId: string }[] } | null>;
  };
};

/**
 * The user-rooted cohort's membership probe: does this person belong to any
 * organization enrolled in this migration. Reads the user's own memberships
 * and intersects them in memory, so no statement grows with the enrolled set.
 */
export class PrismaMigrationMembershipRepository {
  static create({
    prisma,
  }: {
    prisma: PrismaMigrationMembershipDatabase;
  }): PrismaMigrationMembershipRepository {
    return new PrismaMigrationMembershipRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaMigrationMembershipDatabase) {}

  async isMemberOfAny({
    userId,
    organizationIds,
  }: {
    userId: string;
    organizationIds: readonly string[];
  }): Promise<boolean> {
    if (organizationIds.length === 0) return false;
    const enrolled = new Set(organizationIds);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { orgMemberships: { select: { organizationId: true } } },
    });
    return (user?.orgMemberships ?? []).some((membership) =>
      enrolled.has(membership.organizationId),
    );
  }
}
