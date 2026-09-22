import { normalizeIdentifierValue } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { SsoRegistrantReadRepository } from "../sso-registrant.repository.ts";

/** The three models the gate's person questions are read through. */
export type PrismaSsoRegistrantDatabase = Pick<PrismaClient, "user" | "identifier" | "account">;

/** An address somebody proved and still holds. `verifiedAt` alone would also
 *  match a DETACHED tombstone — one they proved once and gave up — which
 *  would keep a connection dialable by a surrendered address. */
const HELD_STATES = ["VERIFIED", "PRIMARY"] as const;

export class PrismaSsoRegistrantReadRepository implements SsoRegistrantReadRepository {
  static create(database: PrismaSsoRegistrantDatabase): PrismaSsoRegistrantReadRepository {
    return new PrismaSsoRegistrantReadRepository(database);
  }

  private constructor(private readonly database: PrismaSsoRegistrantDatabase) {}

  /**
   * Two reads rather than one join, and not by preference: `Identifier`
   * carries a bare `userId` with deliberately no foreign key, so a nested
   * `user.identifiers.some` filter is rejected outright by Prisma.
   */
  async holdsAddress({ userId, email }: { userId: string; email: string }): Promise<boolean> {
    const address = email.trim().toLowerCase();
    if (!address) return false;

    const legacy = await this.database.user.findFirst({
      where: { id: userId, email: { equals: address, mode: "insensitive" } },
      select: { id: true },
    });
    if (legacy !== null) return true;

    const identifier = await this.database.identifier.findFirst({
      where: {
        userId,
        // Folded the way the projection folded it when it was written, which
        // is NFKC as well as lower case: a hand-rolled `toLowerCase()` here
        // compares unequal to what the store already normalized, so a unicode
        // homograph would slip past a match that should have hit.
        value: normalizeIdentifierValue(address),
        state: { in: [...HELD_STATES] },
      },
      select: { id: true },
    });
    return identifier !== null;
  }

  async findAccountHolderIds({
    connectionId,
    accountId,
  }: {
    connectionId: string;
    accountId: string;
  }): Promise<string[]> {
    if (!accountId) return [];

    const rows = await this.database.account.findMany({
      where: { provider: connectionId, providerAccountId: accountId },
      select: { userId: true },
      take: 2,
    });
    return rows.map((row) => row.userId);
  }
}
