import type {
  AnalyticsEvaluationReadMetrics,
  AnalyticsService as AnalyticsServiceContract,
} from "@langwatch/analytics-contract";
import { AnalyticsService } from "./analytics.service.ts";
import { ClickHouseAnalyticsRepository } from "../repositories/clickhouse/clickhouse.analytics.repository.ts";
import { NullAnalyticsEvaluationRepository } from "../repositories/analytics-persistence.repository.ts";
import {
  ClickHouseAnalyticsEvaluationRepository,
  type EvaluationAnalyticsClickHouseClient,
} from "../repositories/clickhouse/clickhouse.analytics-persistence.repository.ts";
import type { AnalyticsTripwire } from "@langwatch/analytics-contract";

/**
 * Process composition binds the one Analytics repository to the service.
 *
 * `resolveClient` answers the SAME narrow session shape
 * ({@link EvaluationAnalyticsClickHouseClient}) both the timeseries repository
 * and the evaluation repository call — one tenant-bound session, not a raw
 * `@clickhouse/client` handle, so whatever builds it (today, a thin wrapper
 * over the process's routing `clickhouse` member) has one shape to satisfy.
 */
export class AnalyticsAdapter {
  static create(options: {
    resolveClient: (tenantId: string) => Promise<EvaluationAnalyticsClickHouseClient | null>;
    clickhouseEnabled: boolean;
    tripwire?: AnalyticsTripwire;
    defaultRetentionDays?: number;
    evaluationReadMetrics?: AnalyticsEvaluationReadMetrics;
  }): AnalyticsServiceContract {
    return AnalyticsService.create({
      repository: ClickHouseAnalyticsRepository.create({
        resolveClient: options.resolveClient,
      }),
      tripwire: options.tripwire,
      evaluationRepository: options.clickhouseEnabled
        ? ClickHouseAnalyticsEvaluationRepository.create({
            resolveClient: options.resolveClient,
            defaultRetentionDays: options.defaultRetentionDays ?? 30,
            readMetrics: options.evaluationReadMetrics,
          })
        : NullAnalyticsEvaluationRepository.create(),
    });
  }
}
