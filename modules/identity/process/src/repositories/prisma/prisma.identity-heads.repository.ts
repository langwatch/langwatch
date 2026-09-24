import type { IdentifierFact, IdentityHeads } from "@langwatch/identity-contract";
import { IdentityIdentifierNotFoundError } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { UserNotFoundError } from "@langwatch/user-contract";

import type { IdentityHeadsRepository } from "../identity-heads.repository.ts";
import { identifierRowToFact } from "./prisma.identifier.mapper.ts";

/**
 * The two models the identity heads are read off, nothing else in the
 * client. Naming them here is what lets the composition root hand its typed
 * `PrismaClient` straight down with no cast at the seam.
 */
export type PrismaIdentityHeadsDatabase = Pick<
  PrismaClient,
  "identifier" | "user" | "identityProjectionCursor"
>;

/**
 * A user's identifier heads, off `Identifier` and `User.userHashKey`. One
 * class rather than two Prisma classes over one table — two would eventually
 * disagree about what a row means. Returns stored facts; policy lives elsewhere.
 */
export class PrismaIdentityHeadsRepository implements IdentityHeadsRepository {
  static create(database: PrismaIdentityHeadsDatabase): PrismaIdentityHeadsRepository {
    return new PrismaIdentityHeadsRepository(database);
  }

  private constructor(private readonly database: PrismaIdentityHeadsDatabase) {}

  async getUserHashKey({ userId }: { userId: string }): Promise<{ userHashKey: string | null }> {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { userHashKey: true },
    });
    if (!user) throw new UserNotFoundError(userId);
    return { userHashKey: user.userHashKey };
  }

  async hasFolded({ userId }: { userId: string }): Promise<boolean> {
    const cursor = await this.database.identityProjectionCursor.findUnique({
      where: { userId },
      select: { userId: true },
    });
    return cursor !== null;
  }

  async findHeads({ userId }: { userId: string }): Promise<IdentityHeads> {
    const rows = await this.database.identifier.findMany({ where: { userId } });
    return {
      userId,
      identifiers: Object.fromEntries(
        rows.map((row) => {
          const fact = identifierRowToFact(row);
          return [fact.identifierId, fact];
        }),
      ),
    };
  }

  async getActiveIdentifierByValue({
    normalizedValue,
  }: {
    normalizedValue: string;
  }): Promise<{ userId: string; identifierId: string }> {
    const row = await this.database.identifier.findFirst({
      where: {
        value: normalizedValue,
        state: { in: ["VERIFIED", "PRIMARY"] },
      },
      select: { id: true, userId: true },
    });
    if (row === null) throw new IdentityIdentifierNotFoundError(`nobody holds ${normalizedValue}`);
    return { userId: row.userId, identifierId: row.id };
  }

  async getIdentifier({
    userId,
    identifierId,
  }: {
    userId: string;
    identifierId: string;
  }): Promise<IdentifierFact> {
    const row = await this.database.identifier.findFirst({
      where: { id: identifierId, userId },
    });
    if (row === null)
      throw new IdentityIdentifierNotFoundError(`${userId} holds no identifier ${identifierId}`);
    return identifierRowToFact(row);
  }

  /**
   * By pinned account id first, then VERBATIM `providerId` — never the
   * folded `provider`, which would let unlinking one enterprise IdP detach
   * another. `take: 2` refuses any ambiguity as not found, never a guess.
   */
  async getIdentifierIdForAccount({
    userId,
    accountId,
    providerId,
  }: {
    userId: string;
    accountId: string;
    providerId: string;
  }): Promise<string> {
    const byAccount = await this.database.identifier.findFirst({
      where: { userId, accountId },
      select: { id: true },
    });
    if (byAccount) return byAccount.id;
    const byProvider = await this.database.identifier.findMany({
      where: { userId, providerId, detachedAt: null },
      select: { id: true },
      take: 2,
    });
    const [only, ...others] = byProvider;
    if (!only || others.length > 0) {
      throw new IdentityIdentifierNotFoundError(
        `no single identifier mirrors account ${accountId}`,
      );
    }
    return only.id;
  }
}
