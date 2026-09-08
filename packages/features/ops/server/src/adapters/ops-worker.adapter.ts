import { createLogger } from "@langwatch/observability";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import type { AnomalyHardTierAlertPort } from "../ports/anomaly-hard-tier-alert.port.ts";
import {
  OpsWorkerPort,
  type OpsWorkerHandle,
  type UsageStatsWorkerConfig,
} from "../ports/ops-worker.port.ts";
import type {
  UsageStatsClickHouseClientResolverPort,
  UsageStatsErrorReporterPort,
  UsageStatsTelemetryClientPort,
  UsageStatsWorkerDatabase,
} from "../ports/usage-stats-worker.port.ts";
import { ClickHouseUsageStatsRepository } from "../repositories/clickhouse/clickhouse.usage-stats.repository.ts";
import { PrismaUsageStatsOrganizationRepository } from "../repositories/prisma/prisma.usage-stats-organization.repository.ts";
import { PrismaUsageStatsProjectRepository } from "../repositories/prisma/prisma.usage-stats-project.repository.ts";
import { RedisAnomalyStateRepository } from "../repositories/redis/redis.anomaly-state.repository.ts";
import { AnomalyDetectorService } from "../services/anomaly-detector.service.ts";
import { UsageStatsCollectionService } from "../services/usage-stats-collection.service.ts";
import {
  AnomalyWorkerContributionAdapter,
  UsageStatsWorkerContributionAdapter,
} from "./ops-worker-contribution.adapter.ts";
import { RedisTenantRateTrackerAdapter } from "./redis.tenant-rate-tracker.adapter.ts";
import { IoredisOpsSnapshotRedisAdapter } from "./ioredis.ops-snapshot-redis.adapter.ts";
import { QueueOpsMetricsSourceAdapter } from "./queue.ops-queue-metrics-source.adapter.ts";
import { RedisOpsSnapshotAdapter } from "./redis.ops-snapshot.adapter.ts";
import { QueueRedisRepository } from "../repositories/redis/queue.repository.ts";
import { RedisOpsMetricsRepository } from "../repositories/redis/redis.ops-metrics.repository.ts";
import { OpsMetricsCollectorService } from "../services/ops-metrics-collector.service.ts";
import { QueueService } from "../services/queue.service.ts";

const anomalyLogger = createLogger("langwatch:observability:anomalyWorker");
const queueMetricsLogger = createLogger("langwatch:ops:queueMetricsWriter");

export interface OpsWorkerAdapterOptions {
  anomaly: {
    redis: IORedis | Cluster | undefined;
    featureFlags: FeatureFlagApi;
    hardTierAlerts: AnomalyHardTierAlertPort;
  };
  /** The connection the queue counters live on; absent leaves the fleet with no writer. */
  queueMetrics: {
    redis: IORedis | Cluster | undefined;
  };
  usageStats: {
    database: UsageStatsWorkerDatabase;
    clickhouse: UsageStatsClickHouseClientResolverPort;
    config: UsageStatsWorkerConfig;
    telemetry: UsageStatsTelemetryClientPort;
    errors: UsageStatsErrorReporterPort;
    builderChartKind: string;
  };
}

/** Composes the complete Ops worker graph from injected infrastructure. */
export class OpsWorkerAdapter extends OpsWorkerPort {
  private constructor(private readonly options: OpsWorkerAdapterOptions) {
    super();
  }

  static create(options: OpsWorkerAdapterOptions): OpsWorkerAdapter {
    return new OpsWorkerAdapter(options);
  }

  tryStartAnomalyWorker(): OpsWorkerHandle | undefined {
    const redis = this.options.anomaly.redis;
    if (!redis) {
      anomalyLogger.warn("Redis connection unavailable, anomaly worker disabled");
      return void 0;
    }

    const detector = AnomalyDetectorService.create({
      rateTracker: RedisTenantRateTrackerAdapter.create({
        redis,
        featureFlags: this.options.anomaly.featureFlags,
      }),
      anomalyState: RedisAnomalyStateRepository.create(redis),
      featureFlags: this.options.anomaly.featureFlags,
      hardTierAlerts: this.options.anomaly.hardTierAlerts,
    });

    return AnomalyWorkerContributionAdapter.create({ detector }).start();
  }

  tryStartQueueMetricsWriter(): OpsWorkerHandle | undefined {
    const redis = this.options.queueMetrics.redis;
    if (!redis) {
      queueMetricsLogger.warn(
        "Redis connection unavailable, ops queue-metrics writer disabled: the operations dashboard has no producer",
      );
      return void 0;
    }

    const collector = OpsMetricsCollectorService.create({
      metrics: RedisOpsMetricsRepository.create({ redis }),
      ops: QueueOpsMetricsSourceAdapter.create(
        QueueService.create({ repo: QueueRedisRepository.create({ redis }) }),
      ),
      snapshots: RedisOpsSnapshotAdapter.create({
        redis: IoredisOpsSnapshotRedisAdapter.create(redis),
      }),
    });
    collector.start().catch((err) => {
      queueMetricsLogger.error({ error: err }, "Failed to start the ops queue-metrics writer");
    });

    return { stop: () => collector.stop() };
  }

  tryStartUsageStatsWorker(): OpsWorkerHandle | undefined {
    const usageStats = this.options.usageStats;
    const collector = UsageStatsCollectionService.create({
      projects: PrismaUsageStatsProjectRepository.create(usageStats.database),
      clickhouse: ClickHouseUsageStatsRepository.create(usageStats.clickhouse),
      builderChartKind: usageStats.builderChartKind,
      now: usageStats.config.now,
    });

    return UsageStatsWorkerContributionAdapter.create({
      config: usageStats.config,
      organizations: PrismaUsageStatsOrganizationRepository.create(usageStats.database),
      usageStats: collector,
      telemetry: usageStats.telemetry,
      errors: usageStats.errors,
    }).start();
  }
}
