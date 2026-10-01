import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  PendingSsoSetupCandidate,
  PendingSsoSetupRepository,
} from "../pending-sso-setup.repository.ts";

/** The client a cleanup run is handed: the flag, and the organization lookup beside it. */
export type PrismaPendingSsoSetupDatabase = PrismaClient;

/** The Prisma-backed {@link PendingSsoSetupRepository}. */
export class PrismaPendingSsoSetupRepository implements PendingSsoSetupRepository {
  static create(prisma: PrismaClient): PrismaPendingSsoSetupRepository {
    return new PrismaPendingSsoSetupRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {}

  async findPendingPage({
    afterId,
    take,
  }: {
    afterId: string | undefined;
    take: number;
  }): Promise<PendingSsoSetupCandidate[]> {
    const users = await this.prisma.user.findMany({
      where: { pendingSsoSetup: true, ...(afterId ? { id: { gt: afterId } } : {}) },
      select: {
        id: true,
        email: true,
        accounts: { select: { provider: true, providerAccountId: true } },
      },
      orderBy: { id: "asc" },
      take,
    });

    return users.map((user) => ({
      id: user.id,
      email: user.email,
      accounts: user.accounts.map((account) => ({
        providerId: account.provider,
        accountId: account.providerAccountId,
      })),
    }));
  }

  async clearPendingSsoSetup({ userId }: { userId: string }): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { pendingSsoSetup: false } });
  }
}
