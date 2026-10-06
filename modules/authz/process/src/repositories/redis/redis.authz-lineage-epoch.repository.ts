import { createLogger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";

import { AuthzLineageEpochRepository } from "../authz-lineage-epoch.repository.ts";

const logger = createLogger("langwatch:authz:lineage-epoch");
const LINEAGE_EPOCH_KEY_PREFIX = "authz:lineage-epoch:";

export type AuthzLineageEpochRedis = Pick<RedisConnection, "get" | "incr">;

/** Redis-backed lineage signal; a never-moved organization reads 0, an unreadable one null. */
export class RedisAuthzLineageEpochRepository extends AuthzLineageEpochRepository {
  static create(options: {
    redis: AuthzLineageEpochRedis | null;
  }): RedisAuthzLineageEpochRepository {
    return new RedisAuthzLineageEpochRepository(options.redis);
  }

  private constructor(private readonly redis: AuthzLineageEpochRedis | null) {
    super();
  }

  async findEpoch({ organizationId }: { organizationId: string }): Promise<number | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(`${LINEAGE_EPOCH_KEY_PREFIX}${organizationId}`);
      if (raw == null) return 0;
      const parsed = /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;
      return Number.isSafeInteger(parsed) ? parsed : null;
    } catch (error) {
      logger.warn({ error, organizationId }, "authz lineage signal read failed");
      return null;
    }
  }

  async bump({ organizationId }: { organizationId: string }): Promise<void> {
    if (!this.redis) return;
    await this.redis.incr(`${LINEAGE_EPOCH_KEY_PREFIX}${organizationId}`);
  }
}
