import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import {
  BetterAuthHooksRepository,
  type BetterAuthHookOrganization,
  type BetterAuthHookUser,
} from "../better-auth-hooks.repository.ts";

/** The Prisma-backed {@link BetterAuthHooksRepository}. */
export class PrismaBetterAuthHooksRepository extends BetterAuthHooksRepository {
  static create(prisma: PrismaClient): PrismaBetterAuthHooksRepository {
    return new PrismaBetterAuthHooksRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async tryFindUserForHooks({ userId }: { userId: string }): Promise<BetterAuthHookUser | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, deactivatedAt: true, pendingSsoSetup: true },
    });
  }

  async tryFindOrganizationBySsoDomain({
    domain,
  }: {
    domain: string;
  }): Promise<BetterAuthHookOrganization | null> {
    return this.prisma.organization.findUnique({
      where: { ssoDomain: domain },
      select: { id: true, name: true, ssoProvider: true },
    });
  }

  async countAccountsForUser({ userId }: { userId: string }): Promise<number> {
    return this.prisma.account.count({ where: { userId } });
  }

  async flagPendingSsoSetup({ userId }: { userId: string }): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pendingSsoSetup: true },
    });
  }

  async createOrganizationMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<"created" | "already-exists"> {
    try {
      await this.prisma.organizationUser.create({
        data: { userId, organizationId, role: "MEMBER" },
      });
      return "created";
    } catch (err) {
      // P2002 (unique constraint) means another concurrent OAuth callback or a
      // retry already created this membership. Any other error is a real
      // failure and propagates instead of being read as an already-present row.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
        throw err;
      }
      return "already-exists";
    }
  }

  async reconcileSsoAccounts({
    userId,
    providerId,
    accountId,
  }: {
    userId: string;
    providerId: string;
    accountId: string;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.account.deleteMany({
        where: {
          userId,
          provider: { not: "credential" },
          OR: [{ provider: { not: providerId } }, { providerAccountId: { not: accountId } }],
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { pendingSsoSetup: false },
      }),
    ]);
  }

  async recordLastLogin({ userId }: { userId: string }): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  async countOrgMembershipsForUser({ userId }: { userId: string }): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { _count: { select: { orgMemberships: true } } },
    });
    return user?._count.orgMemberships ?? 0;
  }
}
