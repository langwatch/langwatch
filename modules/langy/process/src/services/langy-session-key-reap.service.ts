import { LANGY_SESSION_API_KEY_NAME } from "@langwatch/api-key-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import type { LangySessionKeyMetrics } from "../app/langy.members.ts";
import type { LangySessionKeyReapRepository } from "../repositories/langy-session-key-reap.repository.ts";

const logger = createLogger("langwatch:langy:session-key-reap");

/**
 * Retires the Langy session keys their managers never revoked. Revocation on turn end is best-
 * effort by construction: a manager that is SIGKILLed — OOM, node eviction, force-delete — fires no
 * callback at all.
 */
export class LangySessionKeyReapService {
  static create(options: {
    repository: LangySessionKeyReapRepository;
    metrics: LangySessionKeyMetrics;
    now?: () => Instant;
  }): LangySessionKeyReapService {
    return new LangySessionKeyReapService(
      options.repository,
      options.metrics,
      options.now ?? nowInstant,
    );
  }

  private constructor(
    private readonly repository: LangySessionKeyReapRepository,
    private readonly metrics: LangySessionKeyMetrics,
    private readonly now: () => Instant,
  ) {}

  // Revokes every elapsed, unrevoked session key and answers how many. Reads
  // the clock once, so a key is compared against the instant it is stamped
  // with. Arrow property (not a prototype method) since a test extracts this
  // member unbound, checking its arity.
  reap = async (): Promise<number> => {
    const count = await this.repository.revokeExpiredByName({
      name: LANGY_SESSION_API_KEY_NAME,
      now: this.now(),
    });
    if (count > 0) {
      this.metrics.record({ operation: "reaped", count });
      logger.info({ count }, "reaped expired langy session keys");
    }

    return count;
  };
}
