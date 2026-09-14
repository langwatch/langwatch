import type { PrismaClient } from "~/generated/prisma/client";

/**
 * The `Account` rows a sign-in through the organization's configured SSO
 * provider leaves behind, and the flag that says they are there.
 *
 * Account removal is deliberately not part of this repository. Auth0 is a
 * shared broker provider, so a same-provider subject can belong to another
 * organization and cannot be identified as stale from `provider` alone.
 * Exact legacy retirement is handled by the migration finalizer, which has
 * the predecessor connection and identity evidence needed to scope it.
 */
export class PrismaSsoAccountReconciliationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** How many accounts this person holds. Zero means a first-time signup. */
  async countForUser({ userId }: { userId: string }): Promise<number> {
    return await this.prisma.account.count({ where: { userId } });
  }

  /**
   * Completes setup without guessing which other OAuth identities are stale.
   * `keepAccounts` documents the exact accounts authenticated for this
   * callback; it is not authority to delete any account outside that set.
   */
  async reconcileOAuthAccounts({
    userId,
    keepAccounts,
  }: {
    userId: string;
    keepAccounts: readonly { providerId: string; accountId: string }[];
  }): Promise<void> {
    void keepAccounts;
    await this.prisma.user.update({
      where: { id: userId },
      data: { pendingSsoSetup: false },
    });
  }
}
