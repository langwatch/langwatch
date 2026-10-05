import type { RateLimiter } from "@langwatch/process-stores";
import type { RedisConnection } from "@langwatch/redis-client";
import { SessionStateStoreFactory } from "@langwatch/redis-client";

import {
  LangyAnalyticsEventClickHouseRepository,
  type LangyAnalyticsClickHouseMember,
} from "../clickhouse/clickhouse.langy-analytics-event.repository.ts";
import type { LangyRepositories } from "../langy-repositories.registry.ts";
import { LangyFeedbackPromptRedisRepository } from "./redis.langy-feedback-prompt.repository.ts";
import { LangyFrameDedupRedisRepository } from "./redis.langy-frame-dedup.repository.ts";
import { LangyGithubPrCountRedisRepository } from "./redis.langy-github-pr-count.repository.ts";
import { LangyLocalPresenceRedisRepository } from "./redis.langy-local-presence.repository.ts";
import { RedisLangyRateLimitRepository } from "./redis.langy-rate-limit.repository.ts";
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
  static readonly requires = ["redis", "clickhouse", "rateLimiter"] as const;

  static create(
    members: Readonly<{
      redis: RedisConnection;
      clickhouse: LangyAnalyticsClickHouseMember;
      rateLimiter: RateLimiter;
    }>,
  ): LangyRepositories {
    const redis = members.redis;
    const sessionState = SessionStateStoreFactory.redis(redis);

    return {
      turnAccess: LangyTurnAccessRedisRepository.create({ redis }),
      turnHandoff: LangyTurnHandoffRedisRepository.create({ redis }),
      frameDedup: LangyFrameDedupRedisRepository.create({ redis }),
      resourceLinks: LangyResourceLinksRedisRepository.create({ redis }),
      localPresence: LangyLocalPresenceRedisRepository.create({ store: sessionState }),
      sessionState,
      githubPrCounts: LangyGithubPrCountRedisRepository.create({ redis }),
      feedbackPrompts: LangyFeedbackPromptRedisRepository.create({ redis }),
      // A factory row, not a fixed instance: the blocking tail duplicates its
      // own connection per stream, so every call builds a fresh repository
      // over whatever connection the caller borrowed for that stream.
      tokenBuffer: { open: (connection) => LangyTokenBufferRedisRepository.create(connection) },
      analyticsEvents: LangyAnalyticsEventClickHouseRepository.overMember(members.clickhouse),
      rateLimits: RedisLangyRateLimitRepository.create(members.rateLimiter),
    };
  }
}
