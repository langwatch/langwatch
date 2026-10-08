import {
  IdentityIdentifierNotFoundError,
  LIVE_IDENTIFIER_STATES,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../../rules/identity-migration-names.rules.ts";
import type { IdentityResolution, IdentityResolver } from "../../rules/identity-storage.rules.ts";

const logger = createLogger("langwatch:identity:resolution");

/** Only a proven address signs anyone in; an ATTACHED identifier resolves nobody. */
const RESOLVABLE_STATES = ["VERIFIED", "PRIMARY"] as const;

interface ResolutionRow {
  identifierId: string;
  userId: string;
  status: string | null;
  providerId: string | null;
}

/**
 * The reads that carry no `userId` (ADR-116 §2): an identifier and the user's migration-state
 * row in ONE query, so a sign-in never inherits the write gate's TTL cache. Raw SQL because
 * `SystemMigrationTenantState` carries no foreign key. `finalized` alone opens the identity branch.
 */
export class PrismaIdentityResolutionRepository implements IdentityResolver {
  static create(database: PrismaClient): PrismaIdentityResolutionRepository {
    return new PrismaIdentityResolutionRepository(database);
  }

  private constructor(private readonly database: PrismaClient) {}

  async getResolutionByIdentifierValue({
    normalizedValue,
  }: {
    normalizedValue: string;
  }): Promise<IdentityResolution> {
    const row = await this.resolve(
      Prisma.sql`i."value" = ${normalizedValue} AND i."state" IN (${Prisma.join([...RESOLVABLE_STATES])})`,
    );
    return { userId: row.userId, finalized: row.status === "finalized" };
  }

  /** Keyed on better-auth's verbatim `providerId`, the pair `Account` is unique by. */
  async getResolutionByProviderSubject({
    providerId,
    providerAccountId,
  }: {
    providerId: string;
    providerAccountId: string;
  }): Promise<IdentityResolution> {
    const row = await this.resolve(
      Prisma.sql`i."providerId" = ${providerId} AND i."providerAccountId" = ${providerAccountId} AND i."state" IN (${Prisma.join([...LIVE_IDENTIFIER_STATES])})`,
    );
    return { userId: row.userId, finalized: row.status === "finalized" };
  }

  /** A provider that asserts its OWN issuer; hands back the row's `providerId`, never a guess. */
  async getResolutionByIssuerSubject({
    issuer,
    providerAccountId,
  }: {
    issuer: string;
    providerAccountId: string;
  }): Promise<IdentityResolution & { providerId: string }> {
    const row = await this.resolve(
      Prisma.sql`i."issuer" = ${issuer} AND i."providerAccountId" = ${providerAccountId} AND i."state" IN (${Prisma.join([...LIVE_IDENTIFIER_STATES])})`,
    );
    if (row.providerId === null) {
      throw new IdentityIdentifierNotFoundError("no live identifier for this issuer subject");
    }
    return {
      userId: row.userId,
      finalized: row.status === "finalized",
      providerId: row.providerId,
    };
  }

  /** `ORDER BY` fixes which row answers, so a resolution never picks differently between reads. */
  private async resolve(match: Prisma.Sql): Promise<ResolutionRow> {
    const rows = await this.database.$queryRaw<ResolutionRow[]>`
      SELECT i."id" AS "identifierId", i."userId" AS "userId",
             i."providerId" AS "providerId", s."status" AS "status"
      FROM "Identifier" i
      LEFT JOIN "SystemMigrationTenantState" s
        ON s."tenantId" = i."userId"
       AND s."migrationName" = ${IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME}
      WHERE ${match}
      ORDER BY i."attachedAt" ASC, i."id" ASC
      LIMIT 1
    `;
    const row = rows[0];
    if (row === undefined) {
      throw new IdentityIdentifierNotFoundError("no resolvable identifier matched");
    }
    this.touchLastUsed(row.identifierId);
    return row;
  }

  /** `Identifier.lastUsedAt`, fire-and-forget: a timestamp is never worth failing a sign-in. */
  private touchLastUsed(identifierId: string): void {
    void this.database.identifier
      .update({ where: { id: identifierId }, data: { lastUsedAt: new Date() } })
      .catch((error: unknown) => {
        logger.warn(
          { identifierId, error },
          "could not record identifier last-used; sign-in is unaffected",
        );
      });
  }
}
