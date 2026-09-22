import type {
  AnalyticsEvaluationReadMetrics,
  AnalyticsService as AnalyticsServiceContract,
  AnalyticsTripwire,
} from "@langwatch/analytics-contract";

import { NullAnalyticsEvaluationRepository } from "../repositories/analytics-persistence.repository.ts";
import {
  ClickHouseAnalyticsEvaluationRepository,
  type EvaluationAnalyticsClickHouseClient,
} from "../repositories/clickhouse/clickhouse.analytics-persistence.repository.ts";
import { ClickHouseAnalyticsRepository } from "../repositories/clickhouse/clickhouse.analytics.repository.ts";
import { AnalyticsService } from "../services/analytics.service.ts";

/**
 * Process composition binds the one Analytics repository to the service.
 * `resolveClient` answers the same narrow session shape both the timeseries
 * and evaluation repositories call — one tenant-bound session, not a raw client.
 */
export class AnalyticsAdapter {
  static create(options: {
    resolveClient: (tenantId: string) => Promise<EvaluationAnalyticsClickHouseClient | null>;
    clickhouseEnabled: boolean;
    tripwire?: AnalyticsTripwire;
    defaultRetentionDays?: () => number;
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
            defaultRetentionDays: options.defaultRetentionDays ?? (() => 30),
            readMetrics: options.evaluationReadMetrics,
          })
        : NullAnalyticsEvaluationRepository.create(),
    });
  }
}
