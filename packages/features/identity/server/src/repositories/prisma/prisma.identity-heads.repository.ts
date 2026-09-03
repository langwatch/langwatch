import type { IdentifierFact, IdentityHeads } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { IdentityHeadsRepository } from "../../identity-heads.repository";
import { identifierRowToFact } from "./prisma.identifier.mapper";

/**
 * The two models the identity heads are read off, and nothing else in the
 * client.
 *
 * The composition root already holds a typed `PrismaClient`; naming the models
 * here is what lets it hand that client straight down with no cast at the seam.
 */
export type PrismaIdentityHeadsDatabase = Pick<PrismaClient, "identifier" | "user">;

/**
 * A user's identifier heads, read off the `Identifier` projection and
 * `User.userHashKey`.
 *
 * Every read the guards, the ceremonies and the `User.email` fork take, and
 * nothing else. The fork uses one of them (`findHeads`) and satisfies its
 * narrower `IdentityHeadsReader` by being a superset — one class rather than
 * two, because two Prisma classes over one table would eventually disagree
 * about what a row means.
 *
 * Policy — which head answers for an address, what a state allows — lives in
 * the services and in `@langwatch/identity-contract`; this class returns
 * stored facts.
 */
export class PrismaIdentityHeadsRepository implements IdentityHeadsRepository {
  static create(database: PrismaIdentityHeadsDatabase): PrismaIdentityHeadsRepository {
    return new PrismaIdentityHeadsRepository(database);
  }

  private constructor(private readonly database: PrismaIdentityHeadsDatabase) {}

  async findUserHashKey({ userId }: { userId: string }): Promise<string | null> {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { userHashKey: true },
    });
    return user?.userHashKey ?? null;
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

  async findActiveIdentifierByValue({
    normalizedValue,
  }: {
    normalizedValue: string;
  }): Promise<{ userId: string; identifierId: string } | null> {
    const row = await this.database.identifier.findFirst({
      where: {
        value: normalizedValue,
        state: { in: ["VERIFIED", "PRIMARY"] },
      },
      select: { id: true, userId: true },
    });
    return row === null ? null : { userId: row.userId, identifierId: row.id };
  }

  async findIdentifier({
    userId,
    identifierId,
  }: {
    userId: string;
    identifierId: string;
  }): Promise<IdentifierFact | null> {
    const row = await this.database.identifier.findFirst({
      where: { id: identifierId, userId },
    });
    return row === null ? null : identifierRowToFact(row);
  }

  /**
   * By pinned account id first; failing that, the user's live identifiers
   * under the same VERBATIM `providerId` - never the folded `provider`, which
   * collapses every enterprise IdP into `oidc` and would let unlinking one
   * detach the identifier of another the customer still signs in with.
   * `take: 2` is the ambiguity guard: two matches answer null rather than a
   * guess, and so does none.
   */
  async findIdentifierIdForAccount({
    userId,
    accountId,
    providerId,
  }: {
    userId: string;
    accountId: string;
    providerId: string;
  }): Promise<string | null> {
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
    return byProvider.length === 1 ? (byProvider[0]?.id ?? null) : null;
  }
}
