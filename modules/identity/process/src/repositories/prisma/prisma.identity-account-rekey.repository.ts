import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import {
  LEGACY_MICROSOFT_ISSUER,
  MICROSOFT_PROVIDER_ID,
} from "../../rules/microsoft-account-key-move.rules.ts";
import type {
  AccountKeyMove,
  AccountKeyMoveResult,
  IdentityAccountRekeyRepository,
} from "../identity-account-rekey.repository.ts";

/** The one client call the move is made through. */
export type PrismaIdentityAccountRekeyDatabase = Pick<PrismaClient, "$transaction">;

export class PrismaIdentityAccountRekeyRepository implements IdentityAccountRekeyRepository {
  static create(
    database: PrismaIdentityAccountRekeyDatabase,
  ): PrismaIdentityAccountRekeyRepository {
    return new PrismaIdentityAccountRekeyRepository(database);
  }

  private constructor(private readonly database: PrismaIdentityAccountRekeyDatabase) {}

  /** One transaction, so the fold never reads one table moved and the other not. */
  async moveLegacyMicrosoftAccount(move: AccountKeyMove): Promise<AccountKeyMoveResult> {
    try {
      return await this.database.$transaction(async (tx) => {
        const alreadyKeyed = await tx.account.findFirst({
          where: { provider: MICROSOFT_PROVIDER_ID, providerAccountId: move.accountId },
          select: { id: true },
        });
        if (alreadyKeyed) return "unchanged";

        const legacy = await tx.account.findFirst({
          where: {
            provider: MICROSOFT_PROVIDER_ID,
            providerAccountId: move.legacySubject,
            issuer: LEGACY_MICROSOFT_ISSUER,
          },
          select: { id: true },
        });
        if (!legacy) return "unchanged";

        const key = { issuer: move.issuer, providerAccountId: move.accountId };
        await tx.account.update({ where: { id: legacy.id }, data: key });
        await tx.identifier.updateMany({ where: { accountId: legacy.id }, data: key });
        return "rekeyed";
      });
    } catch (error) {
      // A concurrent sign-in of the same user moved the row first.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return "unchanged";
      }
      throw error;
    }
  }
}
