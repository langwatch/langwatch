import { LANGY_SESSION_API_KEY_NAME } from "@langwatch/api-key-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import type { ApiKeyRepository } from "../repositories/api-key.repository.ts";

const logger = createLogger("langwatch:api-key:langy-session");

/**
 * Retires the Langy session keys their managers never revoked. Revocation on turn end is best
 * effort: a manager that is killed outright fires no callback, so this sweep closes the tail.
 */
export class LangySessionKeyReapService {
  static create(options: {
    repository: ApiKeyRepository;
    now?: () => Instant;
  }): LangySessionKeyReapService {
    return new LangySessionKeyReapService(options.repository, options.now ?? nowInstant);
  }

  private constructor(
    private readonly repository: ApiKeyRepository,
    private readonly now: () => Instant,
  ) {}

  /** Revokes every elapsed, unrevoked Langy session key and counts them; reads the clock once. */
  async reap(): Promise<number> {
    const now = this.now();
    const count = await this.repository.revokeExpiredByName({
      name: LANGY_SESSION_API_KEY_NAME,
      now,
    });
    if (count > 0) {
      logger.info({ count }, "reaped expired langy session keys");
    }

    return count;
  }
}
