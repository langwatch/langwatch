// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { nowInstant } from "@langwatch/time";

import type { NurturingClaimRepository } from "../nurturing-claim.repository.ts";

/** One claim per key, lapsing when its window does, as the Redis key expires. */
export class MemoryNurturingClaimRepository implements NurturingClaimRepository {
  readonly #claimedUntil = new Map<string, number>();

  static create(): MemoryNurturingClaimRepository {
    return new MemoryNurturingClaimRepository();
  }

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const now = nowInstant().epochMilliseconds;
    const until = this.#claimedUntil.get(key);
    if (until !== undefined && until > now) return false;
    this.#claimedUntil.set(key, now + ttlSeconds * 1000);
    return true;
  }
}
