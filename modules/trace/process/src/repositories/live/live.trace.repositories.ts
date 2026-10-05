import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { RateLimiter } from "@langwatch/process-stores";
import type { RedisConnection } from "@langwatch/redis-client";

import { ClickHouseTraceClientsRepository } from "../clickhouse/clickhouse.trace-member-client.repository.ts";
import { PostgresTraceRepositories } from "../prisma/prisma.trace.repositories.ts";
import { RedisTraceAnalyticsFoldCacheRepository } from "../redis/redis.trace-analytics-fold-cache.repository.ts";
import { RedisTraceExportSlotRepository } from "../redis/redis.trace-export-slot.repository.ts";
import { RedisTraceRateLimitRepository } from "../redis/redis.trace-rate-limit.repository.ts";
import { RedisTraceSpanDedupRepository } from "../redis/redis.trace-span-dedup.repository.ts";
import { RedisTraceSummaryFoldCacheRepository } from "../redis/redis.trace-summary-fold-cache.repository.ts";
import type { TraceRepositories } from "../trace.repositories.ts";

/** Trace's live stores: corrections in Prisma, rows in ClickHouse, claims and windows in Redis. */
export class LiveTraceRepositories {
  static readonly requires = ["prisma", "clickhouse", "redis", "rateLimiter"] as const;

  static create({
    prisma,
    clickhouse,
    redis,
    rateLimiter,
  }: Readonly<{
    prisma: Parameters<typeof PostgresTraceRepositories.create>[0]["prisma"];
    clickhouse: ClickHouseQueryClient;
    redis: RedisConnection;
    rateLimiter: RateLimiter;
  }>): TraceRepositories {
    return {
      ...PostgresTraceRepositories.create({ prisma, clickhouse }),
      summaryFoldCache: RedisTraceSummaryFoldCacheRepository.create(redis),
      analyticsFoldCache: RedisTraceAnalyticsFoldCacheRepository.create(redis),
      spanDedup: RedisTraceSpanDedupRepository.create({ connection: redis }),
      exportSlots: RedisTraceExportSlotRepository.create({ connection: redis }),
      rateLimits: RedisTraceRateLimitRepository.create(rateLimiter),
      clickhouseClients: ClickHouseTraceClientsRepository.create(clickhouse),
    };
  }
}
