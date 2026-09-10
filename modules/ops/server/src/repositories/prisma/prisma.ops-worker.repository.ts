import { createLogger } from "@langwatch/observability";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import type { AnomalyHardTierAlert } from "../../app/ops.app.ts";
import {
  OpsWorker,
  type OpsWorkerHandle,
  type UsageStatsWorkerConfig,
} from "../../app/ops.app.ts";
import type {
  UsageStatsClickHouseClientResolver,
  UsageStatsErrorReporter,
  UsageStatsTelemetryClient,
  UsageStatsWorkerDatabase,
} from "../../app/ops.app.ts";
import { ClickHouseUsageStatsRepository } from "../clickhouse/clickhouse.usage-stats.repository.ts";
import { PrismaUsageStatsOrganizationRepository } from "./prisma.usage-stats-organization.repository.ts";
import { PrismaUsageStatsProjectRepository } from "./prisma.usage-stats-project.repository.ts";
import { RedisAnomalyStateRepository } from "../redis/redis.anomaly-state.repository.ts";
import { AnomalyDetectorService } from "../../services/anomaly-detector.service.ts";
import { UsageStatsCollectionService } from "../../services/usage-stats-collection.service.ts";
import {
  AnomalyWorkerContributionAdapter,
  UsageStatsWorkerContributionAdapter,
} from "../../services/ops-worker-contribution.service.ts";
import { RedisAnomalyRateTrackerRepository } from "../redis/redis.anomaly-rate-tracker.repository.ts";
import { RedisOpsSnapshotRedisRepository } from "../redis/redis.ops-snapshot-redis.repository.ts";
import { QueueOpsMetricsSourceAdapter } from "../../services/queue.ops-queue-metrics-source.service.ts";
import { RedisOpsSnapshotRepository } from "../redis/redis.ops-snapshot.repository.ts";
import { DefaultOpsSnapshotService } from "../../services/ops-snapshot-reader.service.ts";
import { QueueRedisRepository } from "../redis/queue.repository.ts";
import { RedisOpsMetricsRepository } from "../redis/redis.ops-metrics.repository.ts";
import { OpsMetricsCollectorService } from "../../services/ops-metrics-collector.service.ts";
import { QueueService } from "../../services/queue.service.ts";

const anomalyLogger = createLogger("langwatch:observability:anomalyWorker");
const queueMetricsLogger = createLogger("langwatch:ops:queueMetricsWriter");

export interface OpsWorkerAdapterOptions {
  anomaly: {
    redis: IORedis | Cluster | undefined;
    featureFlags: FeatureFlagApi;
    hardTierAlerts: AnomalyHardTierAlert;
  };
  /** The connection the queue counters live on; absent leaves the fleet with no writer. */
  queueMetrics: {
    redis: IORedis | Cluster | undefined;
  };
  usageStats: {
    database: UsageStatsWorkerDatabase;
    clickhouse: UsageStatsClickHouseClientResolver;
    config: UsageStatsWorkerConfig;
    telemetry: UsageStatsTelemetryClient;
    errors: UsageStatsErrorReporter;
    builderChartKind: string;
  };
}

/** Composes the complete Ops worker graph from injected members. */
export class PrismaOpsWorkerRepository implements OpsWorker {
  private constructor(private readonly options: OpsWorkerAdapterOptions) {
  }

  static create(options: OpsWorkerAdapterOptions): PrismaOpsWorkerRepository {
    return new PrismaOpsWorkerRepository(options);
  }

  tryStartAnomalyWorker(): OpsWorkerHandle | undefined {
    const redis = this.options.anomaly.redis;
    if (!redis) {
      anomalyLogger.warn("Redis connection unavailable, anomaly worker disabled");
      return void 0;
    }

    const detector = AnomalyDetectorService.create({
      rateTracker: RedisAnomalyRateTrackerRepository.create({
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
      snapshots: DefaultOpsSnapshotService.create(
        RedisOpsSnapshotRepository.create(RedisOpsSnapshotRedisRepository.create(redis)),
      ),
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
