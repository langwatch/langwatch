import { LIVE_IDENTIFIER_STATES } from "@langwatch/identity";
import type {
  IdentityResolution,
  IdentityResolutionPort,
} from "@langwatch/identity-server/better-auth";
import { createLogger } from "@langwatch/observability";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../migration-name";

/** Only a proven address signs anyone in. An ATTACHED identifier is one the
 *  user has claimed and not yet verified, and D01's collision guard lets it
 *  block nobody — so it resolves nobody either. */
const logger = createLogger("langwatch:identity:resolution");

const RESOLVABLE_STATES = ["VERIFIED", "PRIMARY"] as const;

interface ResolutionRow {
  identifierId: string;
  userId: string;
  status: string | null;
}

/**
 * The reads that carry no `userId` (ADR-116 §2): an identifier, and the
 * migration-state row that decides whether the identity branch may answer
 * for the user holding it — in ONE query.
 *
 * Joined rather than asked of the write gate on purpose. Resolution is
 * already a Postgres read, so an indexed join adds nothing, and the gate's
 * TTL cache has failure modes a sign-in must not inherit: a stale `false`
 * costs an event on the write path and a sign-in on this one. The residual
 * the ADR names stands — if this table cannot be read, a sign-in by a
 * secondary verified email has no legacy answer to fall back to — and it is
 * bounded by the fact that the same Postgres serves the legacy branch.
 *
 * Raw SQL because the join has no Prisma relation behind it:
 * `SystemMigrationTenantState` is generic over tenants and deliberately
 * carries no foreign key, which is the same reason its own repository keys
 * every query by migration name first.
 */
export class PrismaIdentityResolutionRepository
  implements IdentityResolutionPort
{
  constructor(private readonly prisma: PrismaClient) {}

  async resolveByIdentifierValue({
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
   * folded `provider` vocabulary: auth0, okta and every custom OIDC
   * connection collapse into `oidc`, and a provider subject is unique only
   * WITHIN an issuer, so matching the fold would let one enterprise IdP's
   * subject resolve another IdP's user. This is the pair `Account` is unique
   * by, and a partial unique index enforces it here too.
   */
  async resolveByProviderSubject({
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
    // `ORDER BY` fixes which row answers when more than one matches, so a
    // resolution can never pick differently between two reads - that would
    // be a sign-in that works only sometimes.
    //
    // For the provider-subject lookup a second match should now be
    // impossible: a partial unique index on
    // `(providerId, providerAccountId)` over the live states enforces it in
    // the database. The command-time guard does NOT - it locks the
    // normalized ADDRESS, not the provider subject, so it never constrained
    // this path and the ordering is what stands behind the index. The
    // by-value lookup genuinely can match several rows (one user may hold
    // the same address through several providers), and there the ordering
    // is the whole answer.
    const rows = await this.prisma.$queryRaw<ResolutionRow[]>`
      SELECT i."id" AS "identifierId", i."userId" AS "userId", s."status" AS "status"
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
    this.touchLastUsed(row.identifierId);
    // `finalized` and nothing else, the same predicate the write gate uses:
    // `migrated` is HELD — the rows exist but the parity proof found them
    // behind or disagreeing — so the legacy branch stays this user's truth
    // until the next backfill pass heals them.
    return { userId: row.userId, finalized: row.status === "finalized" };
  }

  /**
   * Records that this identifier answered — `Identifier.lastUsedAt`, the one
   * column on this table the fold does not own.
   *
   * Fire-and-forget on purpose, and not awaited: this runs on the sign-in
   * path, and a timestamp is never worth failing a sign-in for or making one
   * wait on a second round trip. The catch is the whole point — an unwritable
   * column must cost the timestamp and nothing else.
   *
   * It records a RESOLUTION, which is not an authentication: the password,
   * passkey or IdP answer is checked after this returns, so a wrong password
   * moves this timestamp too. The column's comment carries the same warning,
   * because the name alone invites the stronger reading.
   */
  private touchLastUsed(identifierId: string): void {
    void this.prisma.identifier
      .update({
        where: { id: identifierId },
        data: { lastUsedAt: new Date() },
      })
      .catch((error: unknown) => {
        logger.warn(
          { identifierId, error },
          "could not record identifier last-used; sign-in is unaffected",
        );
      });
  }
}
