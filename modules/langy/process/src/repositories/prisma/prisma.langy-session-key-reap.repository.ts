import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { toDate, type Instant } from "@langwatch/time";

import { LangySessionKeyReapRepository } from "../langy-session-key-reap.repository.ts";

/**
 * The one model the sweep touches. `LangyDatabase` names eight models for
 * the wider Langy graph; naming only `apiKey` lets a worker compose the
 * reaper without also claiming the conversation graph.
 */
export type PrismaLangySessionKeyReapDatabase = Pick<PrismaClient, "apiKey">;

export class PrismaLangySessionKeyReapRepository extends LangySessionKeyReapRepository {
  private constructor(private readonly database: PrismaLangySessionKeyReapDatabase) {
    super();
  }

  static create(database: PrismaLangySessionKeyReapDatabase): PrismaLangySessionKeyReapRepository {
    return new PrismaLangySessionKeyReapRepository(database);
  }

  /**
   * One bounded UPDATE over the (name, revokedAt, expiresAt) index. `expiresAt:
   * { not: null }` is load-bearing: a key minted without an expiry never
   * elapses, though SQL would exclude a NULL from `lte` anyway.
   */
  async revokeExpiredByName(input: { name: string; now: Instant }): Promise<number> {
    const now = toDate(input.now);
    const result = await this.database.apiKey.updateMany({
      where: {
        name: input.name,
        revokedAt: null,
        expiresAt: { not: null, lte: now },
      },
      data: { revokedAt: now },
    });
    return result.count;
  }
}
