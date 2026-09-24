import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { UserNotFoundError } from "@langwatch/user-contract";

import type { IdentityUsersRepository } from "../identity-users.repository.ts";

/** The one model the identity guards touch on the legacy side of the fork. */
export type PrismaIdentityUsersDatabase = Pick<PrismaClient, "user" | "$executeRaw">;

/**
 * The two `User` columns identity touches. `userHashKey` is written only
 * when absent (ADR-101 §4), so a concurrently minted key is never overwritten;
 * `User` carries no `projectId` since it's an Identifier/Account-exempt table.
 */
export class PrismaIdentityUsersRepository implements IdentityUsersRepository {
  static create(database: PrismaIdentityUsersDatabase): PrismaIdentityUsersRepository {
    return new PrismaIdentityUsersRepository(database);
  }

  private constructor(private readonly database: PrismaIdentityUsersDatabase) {}

  async storeUserHashKeyIfMissing({
    userId,
    userHashKey,
  }: {
    userId: string;
    userHashKey: string;
  }): Promise<void> {
    // As SQL so a mint parked on the row lock re-checks the committed row;
    // `updateMany`'s subquery would let the second writer overwrite the first.
    await this.database.$executeRaw`
      -- @tenancy: User is an identity table, addressed by its own id.
      UPDATE "User"
         SET "userHashKey" = ${userHashKey},
             "updatedAt" = now()
       WHERE "id" = ${userId}
         AND "userHashKey" IS NULL
    `;
  }

  async getUserEmail({ userId }: { userId: string }): Promise<{ email: string | null }> {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) throw new UserNotFoundError(userId);
    return { email: user.email };
  }

  async findAddressStanding({ userId }: { userId: string }): Promise<{
    email: string | null;
    emailVerified: boolean;
    holders: number;
  } | null> {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true },
    });
    if (!user) return null;
    if (!user.email) return { email: null, emailVerified: !!user.emailVerified, holders: 0 };

    const holders = await this.database.user.count({
      where: { email: { equals: user.email, mode: "insensitive" } },
    });
    return { email: user.email, emailVerified: !!user.emailVerified, holders };
  }

  /**
   * The legacy half of the cross-population collision guard (ADR-116 §6):
   * case-insensitive match on what `User.email @unique` defends. Deactivated
   * users still count as holders, since the unique index still enforces it.
   */
  async findUserIdsByEmail({ normalizedValue }: { normalizedValue: string }): Promise<string[]> {
    const users = await this.database.user.findMany({
      where: { email: { equals: normalizedValue, mode: "insensitive" } },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }
}
