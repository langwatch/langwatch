import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate } from "@langwatch/time";
import { UserNotFoundError } from "@langwatch/user-contract";

import {
  BetterAuthHooksRepository,
  type BetterAuthHookUser,
  type FederatedAccountRow,
} from "../better-auth-hooks.repository.ts";

/** The Prisma-backed {@link BetterAuthHooksRepository}. */
export class PrismaBetterAuthHooksRepository extends BetterAuthHooksRepository {
  static create(prisma: PrismaClient): PrismaBetterAuthHooksRepository {
    return new PrismaBetterAuthHooksRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async getUserForHooks({ userId }: { userId: string }): Promise<BetterAuthHookUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        emailVerified: true,
        deactivatedAt: true,
        pendingSsoSetup: true,
        signupConfirmationPending: true,
      },
    });
    if (user === null) throw new UserNotFoundError(userId);

    return {
      ...user,
      deactivatedAt: user.deactivatedAt === null ? null : fromDate(user.deactivatedAt),
    };
  }

  async countAccountsForUser({ userId }: { userId: string }): Promise<number> {
    return this.prisma.account.count({ where: { userId } });
  }

  async countPasskeysForUser({ userId }: { userId: string }): Promise<number> {
    return this.prisma.passkey.count({ where: { userId } });
  }

  async findFederatedAccountsForUser({
    userId,
  }: {
    userId: string;
  }): Promise<{ providerId: string; accountId: string }[]> {
    const accounts = await this.prisma.account.findMany({
      where: { userId, provider: { not: "credential" } },
      select: { provider: true, providerAccountId: true },
    });
    return accounts.map(({ provider, providerAccountId }) => ({
      providerId: provider,
      accountId: providerAccountId,
    }));
  }

  async findFederatedAccountsForUsers({
    userIds,
  }: {
    userIds: readonly string[];
  }): Promise<FederatedAccountRow[]> {
    if (userIds.length === 0) return [];

    const accounts = await this.prisma.account.findMany({
      where: { userId: { in: [...userIds] }, provider: { not: "credential" } },
      select: { id: true, userId: true, provider: true, providerAccountId: true },
    });

    return accounts.map(({ id, userId, provider, providerAccountId }) => ({
      rowId: id,
      userId,
      providerId: provider,
      accountId: providerAccountId,
    }));
  }

  async deleteAccounts({ accountRowIds }: { accountRowIds: readonly string[] }): Promise<number> {
    if (accountRowIds.length === 0) return 0;

    const { count } = await this.prisma.account.deleteMany({
      where: { id: { in: [...accountRowIds] } },
    });

    return count;
  }

  async flagPendingSsoSetup({ userId }: { userId: string }): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pendingSsoSetup: true },
    });
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
}
