import type { PrismaClient } from "~/generated/prisma/client";

/**
 * The `Account` rows a sign-in through the organization's configured SSO
 * provider leaves behind, and the flag that says they are there.
 *
 * Ordinarily one exact SSO account is kept. During a brokered-to-direct
 * migration the caller names two exact accounts: the grandfathered legacy
 * account and its explicitly linked direct replacement. Credential accounts
 * are preserved for on-prem / email-mode deployments.
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
  async reconcileOAuthAccounts({
    userId,
    keepAccounts,
  }: {
    userId: string;
    keepAccounts: readonly { providerId: string; accountId: string }[];
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.account.deleteMany({
        where: {
          userId,
          // A user can belong to several organizations. Only rotate subjects
          // for providers this callback explicitly proved; unrelated OAuth
          // accounts may be another organization's valid way in.
          provider: {
            in: [...new Set(keepAccounts.map(({ providerId }) => providerId))],
          },
          NOT: keepAccounts.map(({ providerId, accountId }) => ({
            provider: providerId,
            providerAccountId: accountId,
          })),
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { pendingSsoSetup: false },
      }),
    ]);
  }
}
