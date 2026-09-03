import type { PrismaClient } from "~/generated/prisma/client";

/**
 * The `Account` rows a sign-in through the organization's configured SSO
 * provider leaves behind, and the flag that says they are there.
 *
 * Two stale-row cases: the same provider with a different
 * `providerAccountId` (the SSO subject rotated), and a different OAuth
 * provider entirely (somebody had Google linked while the organization's
 * configured SSO is Auth0). Credential accounts are preserved for on-prem /
 * email-mode deployments, which configure no SSO at all.
 */
export class PrismaSsoAccountReconciliationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** How many accounts this person holds. Zero means a first-time signup. */
  async countForUser({ userId }: { userId: string }): Promise<number> {
    return await this.prisma.account.count({ where: { userId } });
  }

  /**
   * Deletes every OAuth account row for this person EXCEPT the one being
   * linked or refreshed, and clears `pendingSsoSetup` in the same
   * transaction.
   *
   * One transaction because the flag is what says the stale rows exist:
   * clearing it separately would leave a window in which somebody is told
   * their SSO is set up while the rows that contradict it are still there.
   */
  async deleteOtherOAuthAccounts({
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
          OR: [
            { provider: { not: providerId } },
            { providerAccountId: { not: accountId } },
          ],
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { pendingSsoSetup: false },
      }),
    ]);
  }
}
