import { createLogger } from "@langwatch/observability";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import type {
  AnomalyFeatureFlagConfig,
  AnomalyFeatureFlagsPort,
} from "../ports/anomaly-feature-flags.port";
import type { AnomalyHardTierAlertPort } from "../ports/anomaly-hard-tier-alert.port";
import {
  OpsWorkerPort,
  type OpsWorkerHandle,
  type UsageStatsWorkerConfig,
} from "../ports/ops-worker.port";
import type {
  UsageStatsClickHouseClientResolver,
  UsageStatsErrorReporter,
  UsageStatsTelemetryClient,
  UsageStatsWorkerDatabase,
} from "../ports/usage-stats-worker.ports";
import { ClickHouseUsageStatsRepository } from "../repositories/clickhouse/clickhouse-usage-stats.repository";
import { PrismaUsageStatsOrganizationRepository } from "../repositories/prisma/prisma-usage-stats-organization.repository";
import { PrismaUsageStatsProjectRepository } from "../repositories/prisma/prisma-usage-stats-project.repository";
import { RedisAnomalyStateRepository } from "../repositories/redis/redis-anomaly-state.repository";
import { AnomalyDetectorService } from "../services/anomaly-detector.service";
import { UsageStatsCollectionService } from "../services/usage-stats-collection.service";
import {
  AnomalyWorkerContribution,
  UsageStatsWorkerContribution,
} from "../workers/ops-worker.contribution";
import { RedisTenantRateTrackerAdapter } from "./redis-tenant-rate-tracker.adapter";

const anomalyLogger = createLogger("langwatch:observability:anomalyWorker");

export interface OpsWorkerAdapterOptions {
  anomaly: {
    redis: IORedis | Cluster | undefined;
    featureFlags: AnomalyFeatureFlagsPort;
    featureFlagConfig: AnomalyFeatureFlagConfig;
    hardTierAlerts: AnomalyHardTierAlertPort;
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

/** Composes the complete Ops worker graph from injected infrastructure. */
export class OpsWorkerAdapter extends OpsWorkerPort {
  private constructor(private readonly options: OpsWorkerAdapterOptions) {
    super();
  }

  static create(options: OpsWorkerAdapterOptions): OpsWorkerAdapter {
    return new OpsWorkerAdapter(options);
  }

  startAnomalyWorker(): OpsWorkerHandle | undefined {
    const redis = this.options.anomaly.redis;
    if (!redis) {
      anomalyLogger.warn("Redis connection unavailable, anomaly worker disabled");
      return void 0;
    }

    const detector = AnomalyDetectorService.create({
      rateTracker: RedisTenantRateTrackerAdapter.create({
        redis,
        featureFlags: this.options.anomaly.featureFlags,
        featureFlagConfig: this.options.anomaly.featureFlagConfig,
      }),
      anomalyState: RedisAnomalyStateRepository.create(redis),
      featureFlags: this.options.anomaly.featureFlags,
      featureFlagConfig: this.options.anomaly.featureFlagConfig,
      hardTierAlerts: this.options.anomaly.hardTierAlerts,
    });

    return AnomalyWorkerContribution.create({ detector }).start();
  }

  startUsageStatsWorker(): OpsWorkerHandle | undefined {
    const usageStats = this.options.usageStats;
    const collector = UsageStatsCollectionService.create({
      projects: PrismaUsageStatsProjectRepository.create(usageStats.database),
      clickhouse: ClickHouseUsageStatsRepository.create(usageStats.clickhouse),
      builderChartKind: usageStats.builderChartKind,
      now: usageStats.config.now,
    });

    return UsageStatsWorkerContribution.create({
      config: usageStats.config,
      organizations: PrismaUsageStatsOrganizationRepository.create(usageStats.database),
      usageStats: collector,
      telemetry: usageStats.telemetry,
      errors: usageStats.errors,
    }).start();
  }
}
