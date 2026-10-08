import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { EventSourcing } from "@langwatch/eventing";
import { EventingClickHouseEventExplorer } from "@langwatch/eventing/server";
import { privateTenantListing } from "@langwatch/process-stores";
import type { RedisConnection } from "@langwatch/redis-client";

import { ClickHouseClickHouseRoutesRepository } from "../clickhouse/clickhouse.clickhouse-routes.repository.ts";
import { ClickHouseClickHouseHealthRepository } from "../clickhouse/clickhouse.datastore-health.repository.ts";
import { ClickHouseStorageFootprintRepository } from "../clickhouse/clickhouse.storage-footprint.repository.ts";
import { EventingPipelineDefinitionsRepository } from "../eventing/eventing.pipeline-definitions.repository.ts";
import type { OpsRepositories } from "../ops.repositories.ts";
import { PostgresOpsRepositories } from "../prisma/prisma.ops.repositories.ts";
import { QueueRedisRepository } from "../redis/queue.repository.ts";
import { RedisAnomalyRateTrackerRepository } from "../redis/redis.anomaly-rate-tracker.repository.ts";
import { RedisAnomalyStateRepository } from "../redis/redis.anomaly-state.repository.ts";
import { BlobStoreRedisRepository } from "../redis/redis.blob-store.repository.ts";
import { RedisRedisHealthRepository } from "../redis/redis.datastore-health.repository.ts";
import { RedisMigrationLeaseRepository } from "../redis/redis.migration-lease.repository.ts";
import { RedisOpsMetricsRepository } from "../redis/redis.ops-metrics.repository.ts";
import { RedisOpsSnapshotRepository } from "../redis/redis.ops-snapshot.repository.ts";
import { ReplayRedisRepository } from "../redis/redis.replay.repository.ts";
import { RedisStorageStatsReadingsRepository } from "../redis/redis.storage-stats-readings.repository.ts";
import { LiveReplayRuntimeRepository } from "./live.replay-runtime.repository.ts";

/**
 * Ops' live stores: its rows in Postgres, the migration lease, the dashboard's snapshots and
 * the queue readings in Redis, the event log and table footprint in ClickHouse, and the pipeline
 * definitions replay and introspection read off eventing.
 */
export const LiveOpsRepositories = {
  ...PostgresOpsRepositories,
  requires: ["prisma", "redis", "clickhouse", "eventing"] as const,
  create: ({
    prisma,
    redis,
    clickhouse,
    eventing,
  }: Readonly<{
    prisma: Parameters<typeof PostgresOpsRepositories.create>[0]["prisma"];
    redis: RedisConnection;
    clickhouse: ClickHouseQueryClient;
    eventing: Pick<EventSourcing, "definitions">;
  }>): OpsRepositories => {
    const privateTenants = privateTenantListing({
      prisma,
      organizationIds: [...clickhouse.privateRoutes().keys()],
    });
    return {
      ...PostgresOpsRepositories.create({ prisma }),
      migrationLease: RedisMigrationLeaseRepository.create({ redis }),
      snapshots: RedisOpsSnapshotRepository.create(redis),
      metrics: RedisOpsMetricsRepository.create({ redis }),
      queues: QueueRedisRepository.create({ redis }),
      blobStore: BlobStoreRedisRepository.create(redis),
      replay: ReplayRedisRepository.create({ redis }),
      replayRuntimes: LiveReplayRuntimeRepository.create({
        redis,
        clickhouse,
        eventing,
        ...(privateTenants === undefined ? {} : { privateTenants }),
      }),
      pipelineDefinitions: EventingPipelineDefinitionsRepository.create({ eventing }),
      clickhouseRoutes: ClickHouseClickHouseRoutesRepository.create({ clickhouse }),
      anomalyState: RedisAnomalyStateRepository.create(redis),
      rateTracker: RedisAnomalyRateTrackerRepository.create({ redis }),
      storageReadings: RedisStorageStatsReadingsRepository.create({ redis }),
      redisHealth: RedisRedisHealthRepository.create(redis),
      clickhouseHealth: ClickHouseClickHouseHealthRepository.create({ clickhouse }),
      events: EventingClickHouseEventExplorer.create({ clickhouse }),
      storageFootprint: ClickHouseStorageFootprintRepository.create({ clickhouse }),
    };
  },
};
