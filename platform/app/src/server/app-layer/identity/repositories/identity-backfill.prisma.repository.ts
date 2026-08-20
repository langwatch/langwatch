import { randomBytes } from "node:crypto";
import type { PrismaClient } from "~/generated/prisma/client";
import type {
  BackfillAccountRow,
  BackfillIdentifierRow,
  BackfillUserRow,
  IdentityBackfillReads,
} from "../migration/identifier-backfill.migration";

/**
 * The backfill's reads over the legacy truth (`User`/`Account`) and the
 * `Identifier` projection it proves itself against, plus the one write the
 * migration owns besides its events: minting a missing `User.userHashKey`
 * (the adapter mints it for new sign-ups; the backfill sweeps the users who
 * predate it, ADR-101 §4).
 */
export class PrismaIdentityBackfillRepository implements IdentityBackfillReads {
  constructor(private readonly prisma: PrismaClient) {}

  async findUser(params: { userId: string }): Promise<BackfillUserRow | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        createdAt: true,
        userHashKey: true,
      },
    });
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      createdAtMs: user.createdAt.getTime(),
      userHashKey: user.userHashKey,
    };
  }

  async mintUserHashKeyIfMissing(params: { userId: string }): Promise<void> {
    // Guarded update: a key minted concurrently (the adapter, another pass)
    // is never overwritten — rewriting it would orphan every hash already
    // computed with the old key.
    await this.prisma.user.updateMany({
      where: { id: params.userId, userHashKey: null },
      data: { userHashKey: randomBytes(32).toString("hex") },
    });
  }

  async findAccountRows(params: {
    userId: string;
  }): Promise<BackfillAccountRow[]> {
    const rows = await this.prisma.account.findMany({
      where: { userId: params.userId },
      select: {
        id: true,
        provider: true,
        providerAccountId: true,
        createdAt: true,
      },
      orderBy: { id: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      providerAccountId: row.providerAccountId,
      createdAtMs: row.createdAt.getTime(),
    }));
  }

  async findIdentifierRows(params: {
    userId: string;
  }): Promise<BackfillIdentifierRow[]> {
    const rows = await this.prisma.identifier.findMany({
      where: { userId: params.userId },
      select: {
        id: true,
        provider: true,
        value: true,
        accountId: true,
        state: true,
      },
    });
    return rows;
  }
}
