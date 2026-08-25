import type { AnalyticsService as AnalyticsServiceContract } from "@langwatch/analytics-contract";
import type { ClickHouseClient } from "@clickhouse/client";
import { AnalyticsService } from "../services/analytics.service";
import { ClickHouseAnalyticsRepository } from "../repositories/clickhouse.analytics.repository";
import type { AnalyticsTripwire } from "@langwatch/analytics-contract";

/** Process composition binds the one Analytics repository to the service. */
export class AnalyticsAdapter {
  static create(options: {
    resolveClient: (tenantId: string) => Promise<ClickHouseClient | null>;
    tripwire?: AnalyticsTripwire;
  }): AnalyticsServiceContract {
    return AnalyticsService.create({
      repository: ClickHouseAnalyticsRepository.create({
        resolveClient: options.resolveClient,
      }),
      tripwire: options.tripwire,
    });
  }
}
