import { LANGY_SESSION_API_KEY_NAME } from "@langwatch/api-key-contract";
import { createLogger } from "@langwatch/observability";
import type { LangySessionKeyMetrics } from "../app/langy.infrastructure.ts";
import type { LangySessionKeyReapRepository } from "../repositories/langy-session-key-reap.repository.ts";
import { nowInstant, type Instant } from "@langwatch/time";

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

  /**
   * Revokes every elapsed, unrevoked session key and answers how many. The clock is read once, so
   * the instant a key is compared against is the instant it is stamped with — a sweep that read the
   * clock twice could revoke a key as of a time it was still valid.
   */
  async reap(): Promise<number> {
    const count = await this.repository.revokeExpiredByName({
      name: LANGY_SESSION_API_KEY_NAME,
      now: this.now(),
    });
    if (count > 0) {
      this.metrics.record({ operation: "reaped", count });
      logger.info({ count }, "reaped expired langy session keys");
    }

    return count;
  }
}
