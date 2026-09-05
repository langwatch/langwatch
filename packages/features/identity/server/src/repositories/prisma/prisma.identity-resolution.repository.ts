import { LIVE_IDENTIFIER_STATES } from "@langwatch/identity-contract";
import type {
  IdentityResolution,
  IdentityResolutionPort,
} from "../../rules/identity-storage-ports.rules";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../../rules/identity-migration-names.rules";

/** Only a proven address signs anyone in. An ATTACHED identifier is one the
 *  user has claimed and not yet verified, and D01's collision guard lets it
 *  block nobody — so it resolves nobody either. */
const RESOLVABLE_STATES = ["VERIFIED", "PRIMARY"] as const;

interface ResolutionRow {
  userId: string;
  status: string | null;
}

/**
 * migration-state row that decides whether the identity branch may answer for the user holding it —
 * in ONE query. Joined rather than asked of the write gate on purpose.
 * The reads that carry no `userId` (ADR-116 §2): an identifier, and the
 */
export class PrismaIdentityResolutionRepository implements IdentityResolutionPort {
  static create(prisma: PrismaClient): PrismaIdentityResolutionRepository {
    return new PrismaIdentityResolutionRepository(prisma);
  }

  constructor(private readonly prisma: PrismaClient) {}

  async tryResolveByIdentifierValue({
    normalizedValue,
  }: {
    normalizedValue: string;
  }): Promise<IdentityResolution | null> {
    return this.resolve(
      Prisma.sql`i."value" = ${normalizedValue} AND i."state" IN (${Prisma.join(RESOLVABLE_STATES)})`,
    );
  }

  /**
   * The IdP callback, keyed on better-auth's own `providerId` and NOT on the
   * folded `provider` vocabulary — a subject is unique only WITHIN an issuer.
   * This is the pair `Account` is unique by.
   */
  async tryResolveByProviderSubject({
    providerId,
    providerAccountId,
  }: {
    providerId: string;
    providerAccountId: string;
  }): Promise<IdentityResolution | null> {
    return this.resolve(
      Prisma.sql`i."providerId" = ${providerId} AND i."providerAccountId" = ${providerAccountId} AND i."state" IN (${Prisma.join([...LIVE_IDENTIFIER_STATES])})`,
    );
  }

  private async resolve(match: Prisma.Sql): Promise<IdentityResolution | null> {
    // `ORDER BY` fixes which row answers when more than one matches, so a resolution can never pick
    // differently between two reads - that would be a sign-in that works only sometimes. For the
    // provider-subject lookup a second match should now be impossible: a partial unique index on
    // `(providerId, providerAccountId)` over the live states enforces it in the database.
    const rows = await this.prisma.$queryRaw<ResolutionRow[]>`
      SELECT i."userId" AS "userId", s."status" AS "status"
      FROM "Identifier" i
      LEFT JOIN "SystemMigrationTenantState" s
        ON s."tenantId" = i."userId"
       AND s."migrationName" = ${IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME}
      WHERE ${match}
      ORDER BY i."attachedAt" ASC, i."id" ASC
      LIMIT 1
    `;
    const row = rows[0];
    if (row === undefined) return null;
    // `finalized` and nothing else, the same predicate the write gate uses:
    // `migrated` is HELD — the rows exist but the parity proof found them
    // behind or disagreeing — so the legacy branch stays this user's truth
    // until the next backfill pass heals them.
    return { userId: row.userId, finalized: row.status === "finalized" };
  }
}
