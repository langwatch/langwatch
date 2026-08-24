import { LIVE_IDENTIFIER_STATES } from "@langwatch/identity";
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
   * `INSERT ... ON CONFLICT DO NOTHING`, then read the holder back. Two
   * statements, one decision: the insert is what races, and the read only
   * reports who won. A read-then-insert would be the very check-then-act this
   * table exists to replace.
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
    await this.prisma.$executeRaw`
      -- @tenancy: the lock is keyed by a normalized address and claimed
      -- before any user is known to hold it, which is what it decides.
      INSERT INTO "IdentifierReservation"
        ("normalizedValue", "userId", "identifierId", "commandId")
      VALUES (${normalizedValue}, ${userId}, ${identifierId}, ${commandId})
      ON CONFLICT ("normalizedValue") DO NOTHING
    `;
    const held = await this.prisma.identifierReservation.findUnique({
      where: { normalizedValue },
    });
    // The row cannot be absent: either this insert wrote it or somebody
    // else's did. A delete racing between the two statements is the one
    // exception, and answering with this caller's own claim is right — the
    // value is free, and the next pass reaps the lock nothing backs.
    return held ?? { normalizedValue, userId, identifierId, commandId };
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
