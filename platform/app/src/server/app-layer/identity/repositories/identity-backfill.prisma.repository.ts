import type { BackfillIdentifierRow, SubjectHolder } from "@langwatch/identity";
import { LIVE_IDENTIFIER_STATES } from "@langwatch/identity";
import type {
  BackfillAccountRow,
  BackfillUserRow,
  IdentityBackfillRepository,
} from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";

/**
 * The backfill's reads over the legacy truth (`User`/`Account`) and the
 * `Identifier` projection it proves itself against. Reads only: the one
 * write the pass owns besides its facts is the users repository's.
 */
export class PrismaIdentityBackfillRepository
  implements IdentityBackfillRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findUser({
    userId,
  }: {
    userId: string;
  }): Promise<BackfillUserRow | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
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

  async findAccountRows({
    userId,
  }: {
    userId: string;
  }): Promise<BackfillAccountRow[]> {
    const rows = await this.prisma.account.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        // better-auth 1.7's account key half. Adopted onto the fact rather
        // than re-derived: a real OIDC issuer is not something the backfill
        // could work out from the provider id, and deriving one would
        // re-key the very account the adoption exists to preserve.
        issuer: true,
        providerAccountId: true,
        createdAt: true,
      },
      orderBy: { id: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      issuer: row.issuer,
      providerAccountId: row.providerAccountId,
      createdAtMs: row.createdAt.getTime(),
    }));
  }

  async findIdentifierRows({
    userId,
  }: {
    userId: string;
  }): Promise<BackfillIdentifierRow[]> {
    return this.prisma.identifier.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        value: true,
        accountId: true,
        state: true,
      },
    });
  }

  /**
   * The live rows holding these subjects, whoever they belong to — the one
   * cross-user read the backfill makes, and only for subjects an expectation
   * is missing. LIVE states only: a tombstone releases the subject, so a
   * DETACHED row holding one explains nothing.
   */
  async findSubjectHolders({
    subjects,
  }: {
    subjects: { providerId: string; providerAccountId: string }[];
  }): Promise<SubjectHolder[]> {
    if (subjects.length === 0) return [];
    const rows = await this.prisma.identifier.findMany({
      where: {
        state: { in: [...LIVE_IDENTIFIER_STATES] },
        OR: subjects.map(({ providerId, providerAccountId }) => ({
          providerId,
          providerAccountId,
        })),
      },
      select: { id: true, providerId: true, providerAccountId: true },
    });
    return rows.flatMap((row) =>
      // Narrowing, not filtering: the columns are nullable on the table and
      // the query already excluded nulls, so this only tells the compiler.
      row.providerId === null || row.providerAccountId === null
        ? []
        : [
            {
              identifierId: row.id,
              providerId: row.providerId,
              providerAccountId: row.providerAccountId,
            },
          ],
    );
  }
}
