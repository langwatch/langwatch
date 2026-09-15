/**
 * The operational loops this process owns, and nothing else does: a per-tenant enqueue-rate tick,
 * the anonymous usage report, the fleet's queue-metrics writer and the ClickHouse storage gauges.
 * @see specs/ops/clickhouse-storage-metrics.feature
 */

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { Anomaly } from "@langwatch/ops-contract";
import {
  type AnomalyHardTierAlert,
  OpsWorkerAdapter,
  OtelStorageStatsMetricsAdapter,
  StorageStatsCollectionService,
  type UsageStatsErrorReporter,
  type UsageStatsTelemetryClient,
  type OpsWorker,
  type StorageStatsInstance,
  type UsageStatsWorkerDatabase,
} from "@langwatch/ops-server";
import { createLogger, type Logger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";

import type { WorkerConfig } from "../platform/config/worker.config.ts";
import { nowInstant } from "@langwatch/time";

/** Where a self-hosted install reports what it is running. */
const USAGE_STATS_RECEIVER = "https://app.langwatch.ai/api/track_usage";

/**
 * The `CustomGraph.kind` a chart built in the chart builder carries.
 */
const BUILDER_CHART_KIND = "builder";

/**
 * Reports the operational loops this process could not compose. Each absence is silent by
 * construction: the anomaly page just never surfaces a tenant, and the storage gauges just never
 * appear.
 */
export abstract class WorkerOpsAbsenceReport {
  abstract withoutAnomalyDetection(): void;

  abstract withoutStorageStats(): void;

  abstract withoutQueueMetricsWriter(): void;
}

export type WorkerOpsCompositionInput = Readonly<{
  config: WorkerConfig;
  database: UsageStatsWorkerDatabase;
  /** The counters the enqueue-rate baseline is kept in; absent disables the tick. */
  redis: RedisConnection | null | undefined;
  featureFlags: FeatureFlagApi;
  /** The process's one routed ClickHouse client, which the usage-stats read runs over. */
  clickhouse: ClickHouseQueryClient | undefined;
  /**
   * Every configured endpoint, for the one read that is nobody's tenant. `system.parts` is a
   * property of an INSTALL rather than of a tenant, and an install with private organization routes
   * has more than one.
   */
  resolveClickHouseInstances: (() => Promise<readonly StorageStatsInstance[]>) | undefined;
  absence?: WorkerOpsAbsenceReport;
}>;

export interface WorkerOpsComposition {
  workers: OpsWorker;
  storageStats: StorageStatsCollectionService | undefined;
}

export function createWorkerOps(options: WorkerOpsCompositionInput): WorkerOpsComposition {
  const logger = createLogger("langwatch:worker:ops");
  if (!options.redis) {
    options.absence?.withoutAnomalyDetection();
    options.absence?.withoutQueueMetricsWriter();
  }

  const workers = OpsWorkerAdapter.create({
    anomaly: {
      redis: options.redis ?? undefined,
      featureFlags: options.featureFlags,
      hardTierAlerts: LoggedHardTierAlert.create(logger),
    },
    queueMetrics: { redis: options.redis ?? undefined },
    usageStats: {
      database: options.database,
      clickhouse: options.clickhouse,
      config: { ...options.config.ops.usageStats, now: nowInstant },
      telemetry: WorkerUsageStatsTelemetry.create(),
      errors: LoggedUsageStatsErrors.create(logger),
      builderChartKind: BUILDER_CHART_KIND,
    },
  });

  const resolveInstances = options.resolveClickHouseInstances;
  if (!resolveInstances) options.absence?.withoutStorageStats();

  return {
    workers,
    storageStats: resolveInstances
      ? StorageStatsCollectionService.create({
          resolveInstances,
          metrics: OtelStorageStatsMetricsAdapter.create(),
          collectBackups: options.config.ops.collectClickHouseBackupMetrics,
        })
      : undefined,
  };
}

/**
 * The hard-tier hook, which logs and pages rather than pausing. Deliberately not an auto-pause: a
 * tenant this loop is wrong about would be cut off by a heuristic, so the detector surfaces the
 * anomaly and an operator decides. The log line is the page.
 */
class LoggedHardTierAlert implements AnomalyHardTierAlert {
  static create(logger: Logger): LoggedHardTierAlert {
    return new LoggedHardTierAlert(logger);
  }

  private constructor(private readonly logger: Logger) {}

  notify(anomaly: Anomaly): Promise<void> {
    this.logger.error(
      {
        tenantId: anomaly.tenantId,
        currentRate: anomaly.currentRate,
        baseline: anomaly.baseline,
        reason: anomaly.reason,
      },
      "HARD-TIER anomaly: manual investigation required (auto-pause not wired)",
    );
    return Promise.resolve();
  }
}

/**
 * The receiver, which is LangWatch's own hosted install. A plain fetch rather than the SSRF-fenced
 * sender: the destination is a constant in this file rather than anything a customer configured, so
 * there is no customer-supplied host to fence and nothing of the customer's own to leak to one.
 */
class WorkerUsageStatsTelemetry implements UsageStatsTelemetryClient {
  static create(): WorkerUsageStatsTelemetry {
    return new WorkerUsageStatsTelemetry();
  }

  private constructor() {}

  async send(report: Record<string, unknown>): Promise<void> {
    await fetch(USAGE_STATS_RECEIVER, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
  }
}

/** A failed report is logged and the loop continues to the next organization. */
class LoggedUsageStatsErrors implements UsageStatsErrorReporter {
  static create(logger: Logger): LoggedUsageStatsErrors {
    return new LoggedUsageStatsErrors(logger);
  }

  private constructor(private readonly logger: Logger) {}

  capture(input: { instanceId: string; error: unknown }): Promise<void> {
    this.logger.error(input, "failed to send usage stats for an install");
    return Promise.resolve();
  }
}

/** Names an absent operational loop in this process's own log. */
export class LoggedWorkerOpsAbsence extends WorkerOpsAbsenceReport {
  static create(logger: Logger): LoggedWorkerOpsAbsence {
    return new LoggedWorkerOpsAbsence(logger);
  }

  private constructor(private readonly logger: Logger) {
    super();
  }

  withoutAnomalyDetection(): void {
    this.logger.warn(
      "worker composed no enqueue-rate anomaly detection: the Ops page surfaces no runaway tenant, and a tenant flooding the queue is visible only as work nobody can drain",
    );
  }

  withoutQueueMetricsWriter(): void {
    this.logger.warn(
      "worker composed no ops queue-metrics writer: the operations dashboard reads a snapshot nothing publishes, so every queue reads as empty rather than as unreported",
    );
  }

  withoutStorageStats(): void {
    this.logger.warn(
      "worker composed no ClickHouse storage-stats collection: the table-size, disk-capacity and backup gauges have no producer, so every alert built on them reads as quiet rather than as unreported",
    );
  }
}
