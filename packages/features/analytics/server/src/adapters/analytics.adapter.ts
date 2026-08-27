import type {
  AnalyticsEvaluationReadMetrics,
  AnalyticsService as AnalyticsServiceContract,
} from "@langwatch/analytics-contract";
import type { ClickHouseClient } from "@clickhouse/client";
import { AnalyticsService } from "../services/analytics.service";
import { ClickHouseAnalyticsRepository } from "../repositories/clickhouse/clickhouse.analytics.repository";
import { NullAnalyticsEvaluationRepository } from "../repositories/analytics-persistence.repository";
import {
  ClickHouseAnalyticsEvaluationRepository,
  type EvaluationAnalyticsClickHouseClient,
} from "../repositories/clickhouse/clickhouse.analytics-persistence.repository";
import type { AnalyticsTripwire } from "@langwatch/analytics-contract";

/** Process composition binds the one Analytics repository to the service. */
export class AnalyticsAdapter {
  static create(options: {
    resolveClient: (tenantId: string) => Promise<ClickHouseClient | null>;
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
            resolveClient: async (tenantId) => {
              const client = await options.resolveClient(tenantId);
              return client ? new ClickHouseEvaluationAnalyticsClient(client) : null;
            },
            defaultRetentionDays: options.defaultRetentionDays ?? 30,
            readMetrics: options.evaluationReadMetrics,
          })
        : NullAnalyticsEvaluationRepository.create(),
    });
  }
}

class ClickHouseEvaluationAnalyticsClient implements EvaluationAnalyticsClickHouseClient {
  constructor(private readonly client: ClickHouseClient) {}

  insert(input: {
    table: string;
    values: Record<string, unknown>[];
    format: "JSONEachRow";
    clickhouse_settings?: import("@clickhouse/client").ClickHouseSettings;
  }): Promise<unknown> {
    return this.client.insert(input);
  }

  async query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: import("@clickhouse/client").ClickHouseSettings;
  }): Promise<{ json(): Promise<Record<string, unknown>[]> }> {
    const result = await this.client.query(input);
    return {
      json: () => result.json<Record<string, unknown>>(),
    };
  }
}
