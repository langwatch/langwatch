import { Temporal, type Instant } from "@langwatch/time";

import { LangySessionKeyReapRepository } from "../langy-session-key-reap.repository.ts";
import type { LangyMemoryStore } from "./langy-memory.store.ts";

/** The memory twin of `PrismaLangySessionKeyReapRepository`: the same bounded revoke. */
export class MemoryLangySessionKeyReapRepository extends LangySessionKeyReapRepository {
  static create(store: LangyMemoryStore): MemoryLangySessionKeyReapRepository {
    return new MemoryLangySessionKeyReapRepository(store);
  }

  private constructor(private readonly store: LangyMemoryStore) {
    super();
  }

  async revokeExpiredByName(input: { name: string; now: Instant }): Promise<number> {
    let count = 0;
    for (const key of this.store.apiKeys.values()) {
      if (key.name !== input.name || key.revokedAt !== null || key.expiresAt === null) continue;
      if (Temporal.Instant.compare(key.expiresAt, input.now) > 0) continue;
      key.revokedAt = input.now;
      count += 1;
    }
    return count;
  }
}
