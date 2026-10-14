import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { EventReadSeat } from "@langwatch/eventing";
import type { ObjectStorage, RateLimiter } from "@langwatch/process-stores";
import type { RedisConnection } from "@langwatch/redis-client";
import type { TraceServerConfig } from "@langwatch/trace-contract";

import { ClickHouseTraceClientsRepository } from "../clickhouse/clickhouse.trace-member-client.repository.ts";
import { EventingTraceEventPayloadRepository } from "../eventing/eventing.trace-event-payload.repository.ts";
import { ObjectStorageTraceSpoolObjectsRepository } from "../object-storage/object-storage.trace-spool-objects.repository.ts";
import { PostgresTraceRepositories } from "../prisma/prisma.trace.repositories.ts";
import { RedisTraceAnalyticsFoldCacheRepository } from "../redis/redis.trace-analytics-fold-cache.repository.ts";
import { RedisTraceExportSlotRepository } from "../redis/redis.trace-export-slot.repository.ts";
import { RedisTraceRateLimitRepository } from "../redis/redis.trace-rate-limit.repository.ts";
import { RedisTraceSpanDedupRepository } from "../redis/redis.trace-span-dedup.repository.ts";
import { RedisTraceSummaryFoldCacheRepository } from "../redis/redis.trace-summary-fold-cache.repository.ts";
import type { TraceRepositories } from "../trace.repositories.ts";

/**
 * Trace's live stores: corrections in Prisma, rows in ClickHouse, claims and windows in Redis,
 * offloaded fields through eventing's one-event read seat, the transient spool in object storage.
 */
export class LiveTraceRepositories {
  static readonly requires = [
    "prisma",
    "clickhouse",
    "redis",
    "rateLimiter",
    "eventReadSeat",
    "objectStorage",
  ] as const;

  static create({
    prisma,
    clickhouse,
    redis,
    rateLimiter,
    eventReadSeat,
    objectStorage,
    config,
  }: Readonly<{
    prisma: Parameters<typeof PostgresTraceRepositories.create>[0]["prisma"];
    clickhouse: ClickHouseQueryClient;
    redis: RedisConnection;
    rateLimiter: RateLimiter;
    eventReadSeat: EventReadSeat;
    objectStorage: ObjectStorage;
    config: Pick<TraceServerConfig, "foldCacheTtlSeconds">;
  }>): TraceRepositories {
    return {
      ...PostgresTraceRepositories.create({ prisma, clickhouse }),
      summaryFoldCache: RedisTraceSummaryFoldCacheRepository.create({
        redis,
        ttlSeconds: config.foldCacheTtlSeconds,
      }),
      analyticsFoldCache: RedisTraceAnalyticsFoldCacheRepository.create({
        redis,
        ttlSeconds: config.foldCacheTtlSeconds,
      }),
      spanDedup: RedisTraceSpanDedupRepository.create({ connection: redis }),
      exportSlots: RedisTraceExportSlotRepository.create({ connection: redis }),
      rateLimits: RedisTraceRateLimitRepository.create(rateLimiter),
      clickhouseClients: ClickHouseTraceClientsRepository.create(clickhouse),
      eventPayloads: EventingTraceEventPayloadRepository.create({ eventReadSeat }),
      spoolObjects: ObjectStorageTraceSpoolObjectsRepository.create({ objectStorage }),
    };
  }
}
