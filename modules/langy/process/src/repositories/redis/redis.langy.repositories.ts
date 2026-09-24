import type { RedisConnection } from "@langwatch/redis-client";
import { SessionStateStoreFactory } from "@langwatch/redis-client";

import type { LangyRepositories } from "../langy-repositories.registry.ts";
import { LangyFrameDedupRedisRepository } from "./redis.langy-frame-dedup.repository.ts";
import { LangyLocalPresenceRedisRepository } from "./redis.langy-local-presence.repository.ts";
import { LangyResourceLinksRedisRepository } from "./redis.langy-resource-links.repository.ts";
import { LangyTokenBufferRedisRepository } from "./redis.langy-token-buffer.repository.ts";
import { LangyTurnAccessRedisRepository } from "./redis.langy-turn-access.repository.ts";
import { LangyTurnHandoffRedisRepository } from "./redis.langy-turn-handoff.repository.ts";

/**
 * The live tier. Langy keeps no row of its own in Postgres outside the
 * event log its fold owns, so the tier is named for the deployment, not
 * the store: every row here lives in the process's Redis.
 */
export class PostgresLangyRepositories {
  static readonly requires = ["redis"] as const;

  static create(members: Readonly<{ redis: RedisConnection }>): LangyRepositories {
    const redis = members.redis;

    return {
      turnAccess: LangyTurnAccessRedisRepository.create({ redis }),
      turnHandoff: LangyTurnHandoffRedisRepository.create({ redis }),
      frameDedup: LangyFrameDedupRedisRepository.create({ redis }),
      resourceLinks: LangyResourceLinksRedisRepository.create({ redis }),
      localPresence: LangyLocalPresenceRedisRepository.create({
        store: SessionStateStoreFactory.redis(redis),
      }),
      // A factory row, not a fixed instance: the blocking tail duplicates its
      // own connection per stream, so every call builds a fresh repository
      // over whatever connection the caller borrowed for that stream.
      tokenBuffer: { open: (connection) => LangyTokenBufferRedisRepository.create(connection) },
    };
  }
}
