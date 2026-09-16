import { LIVE_IDENTIFIER_STATES } from "@langwatch/identity-contract";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { toDate, type Instant } from "@langwatch/time";
import type {
  IdentifierReservationHolder,
  IdentityReservationRepository,
} from "../identity-reservations.repository.ts";

/**
 * The lock table plus the raw escape hatch the claim and the sweep are
 * written in — one statement each, for the reasons below, and neither is
 * expressible through the fluent client.
 */
export type PrismaIdentityReservationsDatabase = Pick<
  PrismaClient,
  "identifierReservation" | "$queryRaw"
>;

/**
 * The address lock over Postgres (ADR-116 §6). Deliberately exempt from the
 * multitenancy middleware — keyed by a normalized address, claimed before
 * any user is known to hold it.
 */
export class PrismaIdentityReservationRepository implements IdentityReservationRepository {
  static create(database: PrismaIdentityReservationsDatabase): PrismaIdentityReservationRepository {
    return new PrismaIdentityReservationRepository(database);
  }

  private constructor(private readonly database: PrismaIdentityReservationsDatabase) {}

  /**
   * ONE statement: `ON CONFLICT DO UPDATE ... RETURNING` always returns a row
   * (mine or the incumbent's), closing the window a separate insert-then-read
   * would leave for two claimants to both see the address as free.
   */
  async claim({
    normalizedValue,
    userId,
    identifierId,
    commandId,
  }: {
    normalizedValue: string;
    userId: string;
    identifierId: string;
    commandId: string;
  }): Promise<IdentifierReservationHolder> {
    const [held] = await this.database.$queryRaw<IdentifierReservationHolder[]>`
      -- @tenancy: the lock is keyed by a normalized address and claimed
      -- before any user is known to hold it, which is what it decides.
      INSERT INTO "IdentifierReservation"
        ("normalizedValue", "userId", "identifierId", "commandId")
      VALUES (${normalizedValue}, ${userId}, ${identifierId}, ${commandId})
      ON CONFLICT ("normalizedValue") DO UPDATE
        SET "normalizedValue" = "IdentifierReservation"."normalizedValue"
      RETURNING "normalizedValue", "userId", "identifierId", "commandId"
    `;
    if (held === undefined) {
      // Unreachable by construction: the statement either inserts or updates,
      // and both return their row. Refusing loudly rather than inventing a
      // holder, because a claim that answers without a row behind it is the
      // one failure this table cannot tolerate.
      throw new Error(
        "the address lock returned no holder; the claim statement must always return the winning row",
      );
    }
    return held;
  }

  async release({
    userId,
    holdingIdentifierIds,
  }: {
    userId: string;
    holdingIdentifierIds: readonly string[];
  }): Promise<number> {
    const { count } = await this.database.identifierReservation.deleteMany({
      where: {
        userId,
        identifierId: { notIn: [...holdingIdentifierIds] },
      },
    });
    return count;
  }

  /**
   * Locks whose fact never landed. Bounded, and behind a horizon: a claim
   * taken moments ago belongs to a ceremony still in flight, and reaping it
   * would hand its address to somebody else mid-ceremony.
   */
  async reapOrphans({ olderThan, limit }: { olderThan: Instant; limit: number }): Promise<number> {
    const orphans = await this.database.$queryRaw<{ normalizedValue: string }[]>`
      -- @tenancy: the sweep is fleet-wide by construction - it hunts locks
      -- that no user's live identifier backs.
      SELECT r."normalizedValue"
      FROM "IdentifierReservation" r
      LEFT JOIN "Identifier" i
        ON i."id" = r."identifierId"
       AND i."state" IN (${Prisma.join([...LIVE_IDENTIFIER_STATES])})
      WHERE r."createdAt" < ${toDate(olderThan)}
        AND i."id" IS NULL
      ORDER BY r."createdAt" ASC
      LIMIT ${limit}
    `;
    if (orphans.length === 0) return 0;
    const { count } = await this.database.identifierReservation.deleteMany({
      where: {
        normalizedValue: { in: orphans.map((row) => row.normalizedValue) },
      },
    });
    return count;
  }
}
