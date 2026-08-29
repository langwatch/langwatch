import { LIVE_IDENTIFIER_STATES } from "@langwatch/identity-contract";
import type {
  IdentifierReservationHolder,
  IdentityReservationRepository,
} from "@langwatch/identity-server";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";

/**
 * The address lock over Postgres (ADR-116 §6).
 *
 * `IdentifierReservation` is not project-scoped and is deliberately exempt
 * from the multitenancy middleware: it is keyed by a normalized address and
 * claimed before any user is known to hold it, which is the whole point.
 */
export class PrismaIdentityReservationRepository
  implements IdentityReservationRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * ONE statement, and that is the whole design.
   *
   * `ON CONFLICT DO UPDATE ... RETURNING` returns the row that ends up
   * holding the key — this caller's on an insert, the incumbent's on a
   * conflict. `DO NOTHING ... RETURNING` returns no row at all on conflict,
   * which is why this cannot be written that way and then read back: an
   * insert followed by a separate `findUnique` is two statements, and a
   * `release()` or `reapOrphans()` deleting the incumbent's row between them
   * returns nothing while the key sits free. Answering that with the
   * caller's own claim would tell them they hold a lock that does not
   * exist — and the next caller, inserting into the now-free key, would be
   * told the same. Two users staging facts for one address is exactly the
   * cross-user double-verification this table exists to prevent, and nothing
   * downstream catches it: `Identifier.value` deliberately carries no unique
   * constraint. `reapOrphans` cannot help either, because the defect is the
   * ABSENCE of a row, not a stale one.
   *
   * The `SET` is a deliberate no-op — assigning the column to itself is what
   * makes the row visible to `RETURNING` without changing it. Concurrent
   * claimants on one key serialize on that row lock, which is the behaviour
   * wanted: the second waits microseconds and then reads the real winner.
   * There is no outer transaction anywhere on this path, so the lock is held
   * for one statement and can never take part in a lock-ordering cycle.
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
    const [held] = await this.prisma.$queryRaw<IdentifierReservationHolder[]>`
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
    const { count } = await this.prisma.identifierReservation.deleteMany({
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
  async reapOrphans({
    olderThan,
    limit,
  }: {
    olderThan: Date;
    limit: number;
  }): Promise<number> {
    const orphans = await this.prisma.$queryRaw<{ normalizedValue: string }[]>`
      -- @tenancy: the sweep is fleet-wide by construction - it hunts locks
      -- that no user's live identifier backs.
      SELECT r."normalizedValue"
      FROM "IdentifierReservation" r
      LEFT JOIN "Identifier" i
        ON i."id" = r."identifierId"
       AND i."state" IN (${Prisma.join([...LIVE_IDENTIFIER_STATES])})
      WHERE r."createdAt" < ${olderThan}
        AND i."id" IS NULL
      ORDER BY r."createdAt" ASC
      LIMIT ${limit}
    `;
    if (orphans.length === 0) return 0;
    const { count } = await this.prisma.identifierReservation.deleteMany({
      where: {
        normalizedValue: { in: orphans.map((row) => row.normalizedValue) },
      },
    });
    return count;
  }
}
