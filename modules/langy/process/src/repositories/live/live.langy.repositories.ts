import type { RateLimiter } from "@langwatch/process-stores";
import type { RedisConnection } from "@langwatch/redis-client";

import {
  LangyAnalyticsEventClickHouseRepository,
  type LangyAnalyticsClickHouseMember,
} from "../clickhouse/clickhouse.langy-analytics-event.repository.ts";
import type { LangyRepositories } from "../langy-repositories.registry.ts";
import type { LangyDatabase } from "../prisma/langy-database.mapper.ts";
import { PrismaLangySessionKeyReapRepository } from "../prisma/prisma.langy-session-key-reap.repository.ts";
import { PrismaLangyRepositories } from "../prisma/prisma.langy.repositories.ts";
import { RedisLangyRateLimitRepository } from "../redis/redis.langy-rate-limit.repository.ts";
import { RedisLangyRepositories } from "../redis/redis.langy.repositories.ts";

/** Langy's live stores: its tables in Postgres, the live edge in Redis, the grain in ClickHouse. */
export class LiveLangyRepositories {
  static readonly requires = ["prisma", "redis", "clickhouse", "rateLimiter"] as const;

  static create({
    prisma,
    redis,
    clickhouse,
    rateLimiter,
  }: Readonly<{
    prisma: LangyDatabase;
    redis: RedisConnection;
    clickhouse: LangyAnalyticsClickHouseMember;
    rateLimiter: RateLimiter;
  }>): LangyRepositories {
    return {
      ...PrismaLangyRepositories.create(prisma),
      sessionKeyReap: PrismaLangySessionKeyReapRepository.create(prisma),
      ...RedisLangyRepositories.create(redis),
      analyticsEvents: LangyAnalyticsEventClickHouseRepository.overMember(clickhouse),
      rateLimits: RedisLangyRateLimitRepository.create(rateLimiter),
    };
  }
}
