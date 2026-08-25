import { createLogger } from "@langwatch/observability";
import { AuthzEpochPort } from "../ports/authz-epoch.port";

const logger = createLogger("langwatch:authz:epoch");
const EPOCH_KEY_PREFIX = "authz:epoch:";

export type AuthzEpochRedis = {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<unknown>;
};

export type RedisAuthzEpochAdapterOptions = {
  redis: AuthzEpochRedis | null;
};

/** Redis-backed epoch; unavailable or malformed state disables caching. */
export class RedisAuthzEpochAdapter extends AuthzEpochPort {
  static create(
    options: RedisAuthzEpochAdapterOptions,
  ): RedisAuthzEpochAdapter {
    return new RedisAuthzEpochAdapter(options.redis);
  }

  private constructor(private readonly redis: AuthzEpochRedis | null) {
    super();
  }

  async tryRead({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(`${EPOCH_KEY_PREFIX}${organizationId}`);
      if (raw == null || !/^-?\d+$/.test(raw)) return null;
      const parsed = Number(raw);
      return Number.isSafeInteger(parsed) ? parsed : null;
    } catch (error) {
      logger.warn({ error, organizationId }, "authz epoch read failed");
      return null;
    }
  }

  async bump({ organizationId }: { organizationId: string }): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.incr(`${EPOCH_KEY_PREFIX}${organizationId}`);
    } catch (error) {
      logger.warn({ error, organizationId }, "authz epoch bump failed");
    }
  }
}
