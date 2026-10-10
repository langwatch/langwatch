import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { METRIC_DEFAULT_RETENTION_DAYS } from "@langwatch/metric-contract";

import { ClickHouseMetricDataPointAppendRepository } from "../clickhouse/clickhouse.metric-data-point-append.repository.ts";
import type { MetricRepositories } from "../metric.repositories.ts";

/** The live tier: data points in the process's one routed ClickHouse client. */
export class LiveMetricRepositories {
  static readonly requires = ["clickhouse"] as const;

  static create({
    clickhouse,
  }: Readonly<{ clickhouse: ClickHouseQueryClient }>): MetricRepositories {
    return {
      dataPoints: ClickHouseMetricDataPointAppendRepository.create({
        resolveClient: ClickHouseMetricDataPointAppendRepository.resolverOver(clickhouse),
        defaultRetentionDays: METRIC_DEFAULT_RETENTION_DAYS,
      }),
    };
  }
}
