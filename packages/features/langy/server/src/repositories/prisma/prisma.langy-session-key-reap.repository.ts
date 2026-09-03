import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { LangySessionKeyReapRepository } from "../langy-session-key-reap.repository";

/**
 * The one model the sweep touches, and nothing else in the client.
 *
 * `LangyDatabase` names eight models and a transaction because the Langy graph
 * needs them; the sweep needs `apiKey`. Naming only that is what lets a worker
 * that mounts the reaper compose it from the process's Prisma client without
 * also claiming to hold the conversation graph.
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
   * One bounded UPDATE over the (name, revokedAt, expiresAt) index added in
   * 20260728120000. `expiresAt: { not: null }` is load-bearing: a key minted
   * without an expiry never elapses, and a NULL compared with `lte` would be
   * excluded by SQL anyway — stating it keeps the predicate readable as the
   * three conditions the tenancy guard is written against.
   */
  async revokeExpiredByName(input: { name: string; now: Date }): Promise<number> {
    const result = await this.database.apiKey.updateMany({
      where: {
        name: input.name,
        revokedAt: null,
        expiresAt: { not: null, lte: input.now },
      },
      data: { revokedAt: input.now },
    });
    return result.count;
  }
}
