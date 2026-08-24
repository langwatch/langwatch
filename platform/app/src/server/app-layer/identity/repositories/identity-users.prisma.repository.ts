import type { IdentityUsersRepository } from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";

/**
 * The two `User` columns identity touches.
 *
 * The `userHashKey` write is guarded (ADR-101 §4): only a user without a key
 * takes one, so a key minted concurrently — by the ceremony at user
 * creation, by another backfill pass — is never overwritten. Rewriting it
 * would orphan every identifier hash already computed with the old key.
 */
export class PrismaIdentityUsersRepository implements IdentityUsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async storeUserHashKeyIfMissing({
    userId,
    userHashKey,
  }: {
    userId: string;
    userHashKey: string;
  }): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId, userHashKey: null },
      data: { userHashKey },
    });
  }

  async findEmail({ userId }: { userId: string }): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? null;
  }
}
