import type { PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * The user-rooted cohort's membership probe: does this person belong to any
 * organization enrolled in this migration. One indexed read per candidate
 * user, rather than materializing every enrolled organization's member list.
 */
export class PrismaMigrationMembershipRepository {
  static create({ prisma }: { prisma: PrismaClient }): PrismaMigrationMembershipRepository {
    return new PrismaMigrationMembershipRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {}

  async isMemberOfAny({
    userId,
    organizationIds,
  }: {
    userId: string;
    organizationIds: readonly string[];
  }): Promise<boolean> {
    if (organizationIds.length === 0) return false;
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId, organizationId: { in: [...organizationIds] } },
      select: { userId: true },
    });
    return membership !== null;
  }
}
