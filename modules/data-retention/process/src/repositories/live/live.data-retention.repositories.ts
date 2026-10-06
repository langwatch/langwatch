import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import { ClickHouseRetroactiveRetentionRepository } from "../clickhouse/clickhouse.retroactive-retention.repository.ts";
import { ClickHouseStorageMeterRepository } from "../clickhouse/clickhouse.storage-meter.repository.ts";
import { DATA_RETENTION_CACHE_TTL_MS } from "../data-retention-cache.repository.ts";
import type { DataRetentionRepositories } from "../data-retention.repositories.ts";
import { PostgresDataRetentionRepositories } from "../prisma/prisma.data-retention.repositories.ts";
import {
  type DataRetentionRedis,
  RedisDataRetentionCacheRepository,
} from "../redis/redis.data-retention-cache.repository.ts";
import {
  RedisStorageMeterCacheRepository,
  type StorageMeterRedis,
} from "../redis/redis.storage-meter-cache.repository.ts";
import { STORAGE_METER_CACHE_TTL_MS } from "../storage-meter-cache.repository.ts";

/**
 * Data-retention's live stores: rules and pins in Postgres, rewrites and the storage meter in
 * ClickHouse, both caches in Redis. A deployment without one of them refuses at boot by name
 * rather than silently metering at zero.
 */
export class LiveDataRetentionRepositories {
  static readonly requires = ["prisma", "clickhouse", "redis"] as const;
  static readonly repositories = PostgresDataRetentionRepositories.repositories;

  static create({
    prisma,
    clickhouse,
    redis,
  }: Readonly<{
    prisma: Parameters<typeof PostgresDataRetentionRepositories.create>[0]["prisma"];
    clickhouse: ClickHouseQueryClient;
    redis: DataRetentionRedis & StorageMeterRedis;
  }>): DataRetentionRepositories {
    return {
      ...PostgresDataRetentionRepositories.create({ prisma }),
      retroactive: ClickHouseRetroactiveRetentionRepository.create({ clickhouse }),
      storageMeter: ClickHouseStorageMeterRepository.create({ clickhouse }),
      cache: RedisDataRetentionCacheRepository.create({
        redis,
        ttlMs: DATA_RETENTION_CACHE_TTL_MS,
      }),
      storageMeterCache: RedisStorageMeterCacheRepository.create({
        redis,
        ttlMs: STORAGE_METER_CACHE_TTL_MS,
      }),
    };
  }
}
