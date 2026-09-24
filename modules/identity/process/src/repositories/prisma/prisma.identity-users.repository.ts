import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { IdentityUsersRepository } from "../identity-users.repository.ts";

/** The one model the identity guards touch on the legacy side of the fork. */
export type PrismaIdentityUsersDatabase = Pick<PrismaClient, "user" | "$executeRaw" | "$queryRaw">;

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

  async tryFindEmail({ userId }: { userId: string }): Promise<string | null> {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? null;
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

    // Exact equality, not Prisma's insensitive `equals`: that compiles to ILIKE,
    // where an `_` in the address matches any character and counts a stranger.
    const [row] = await this.database.$queryRaw<{ holders: bigint }[]>`
      -- @tenancy: an address names one account fleet-wide or it names nobody.
      SELECT count(*) AS "holders" FROM "User" WHERE lower("email") = lower(${user.email})
    `;
    return {
      email: user.email,
      emailVerified: !!user.emailVerified,
      holders: Number(row?.holders ?? 0),
    };
  }

  /**
   * The legacy half of the cross-population collision guard (ADR-116 §6):
   * case-insensitive match on what `User.email @unique` defends. Deactivated
   * users still count as holders, since the unique index still enforces it.
   */
  async tryFindUserIdByEmail({
    normalizedValue,
  }: {
    normalizedValue: string;
  }): Promise<string | null> {
    const user = await this.database.user.findFirst({
      where: { email: { equals: normalizedValue, mode: "insensitive" } },
      select: { id: true },
    });
    return user?.id ?? null;
  }
}
