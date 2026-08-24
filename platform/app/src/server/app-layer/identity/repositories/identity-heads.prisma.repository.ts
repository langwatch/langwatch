import type {
  IdentifierFact,
  IdentifierProvider,
  IdentityHeads,
} from "@langwatch/identity";
import type { IdentityHeadsRepository } from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { rowToFact } from "./identifier-row";

/**
 * The Prisma implementation of IdentityHeadsRepository: every read the
 * guards and the ceremonies take over the `Identifier` projection and
 * `User.userHashKey`, and nothing else. Policy — what a state allows, what
 * the heads must carry — lives in `@langwatch/identity-server`; this class
 * returns stored facts.
 */
export class PrismaIdentityHeadsRepository implements IdentityHeadsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findUserHashKey({
    userId,
  }: {
    userId: string;
  }): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { userHashKey: true },
    });
    return user?.userHashKey ?? null;
  }

  async findHeads({ userId }: { userId: string }): Promise<IdentityHeads> {
    const rows = await this.prisma.identifier.findMany({ where: { userId } });
    return {
      userId,
      identifiers: Object.fromEntries(
        rows.map((row) => {
          const fact = rowToFact(row);
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
    const row = await this.prisma.identifier.findFirst({
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
    const row = await this.prisma.identifier.findFirst({
      where: { id: identifierId, userId },
    });
    return row === null ? null : rowToFact(row);
  }

  async findIdentifierIdForAccount({
    userId,
    accountId,
    provider,
  }: {
    userId: string;
    accountId: string;
    provider: IdentifierProvider;
  }): Promise<string | null> {
    const byAccount = await this.prisma.identifier.findFirst({
      where: { userId, accountId },
      select: { id: true },
    });
    if (byAccount) return byAccount.id;
    const byProvider = await this.prisma.identifier.findMany({
      where: { userId, provider, detachedAt: null },
      select: { id: true },
      take: 2,
    });
    return byProvider.length === 1 ? (byProvider[0]?.id ?? null) : null;
  }
}
