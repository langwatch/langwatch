import type { AnalyticsMetricSource } from "@langwatch/analytics-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { type Instant, Temporal } from "@langwatch/time";

import { AnalyticsRecencyRepository } from "../analytics-recency.repository.ts";

const SLIM_TABLE_BY_SOURCE: Record<AnalyticsMetricSource, string> = {
  trace: "trace_analytics",
  evaluation: "evaluation_analytics",
};

const AGGREGATE_ID_COLUMN_BY_SOURCE: Record<AnalyticsMetricSource, string> = {
  trace: "TraceId",
  evaluation: "EvaluationId",
};

/**
 * Reads the newest `OccurredAt` of the deduped slim table (ADR-034 §6), bounded
 * on the partition column, with the IN-tuple dedup over `ReplacingMergeTree(UpdatedAt)`.
 */
export class ClickHouseAnalyticsRecencyRepository extends AnalyticsRecencyRepository {
  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
  }

  static create(clickhouse: ClickHouseQueryClient): ClickHouseAnalyticsRecencyRepository {
    return new ClickHouseAnalyticsRecencyRepository(clickhouse);
  }

  async findLastOccurredAt(input: {
    projectId: string;
    source: AnalyticsMetricSource;
    since: Instant;
  }): Promise<Instant[]> {
    const table = SLIM_TABLE_BY_SOURCE[input.source];
    const idColumn = AGGREGATE_ID_COLUMN_BY_SOURCE[input.source];
    const { rows } = await this.clickhouse.query<{ lastMs: string | number | null }>({
      tenantId: input.projectId,
      table,
      sql: `
        SELECT max(toUnixTimestamp64Milli(OccurredAt)) AS lastMs
        FROM (
          SELECT OccurredAt
          FROM ${table}
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= toDateTime64({startMs:UInt64} / 1000.0, 3)
            AND (TenantId, ${idColumn}, UpdatedAt) IN (
              SELECT TenantId, ${idColumn}, max(UpdatedAt)
              FROM ${table}
              WHERE TenantId = {tenantId:String}
                AND OccurredAt >= toDateTime64({startMs:UInt64} / 1000.0, 3)
              GROUP BY TenantId, ${idColumn}
            )
        )
      `,
      params: { tenantId: input.projectId, startMs: input.since.epochMilliseconds },
    });

    const lastMs = rows[0]?.lastMs;
    if (lastMs === null || lastMs === undefined) return [];
    const ms = typeof lastMs === "string" ? Number.parseInt(lastMs, 10) : lastMs;
    if (!Number.isFinite(ms) || ms <= 0) return [];
    return [Temporal.Instant.fromEpochMilliseconds(ms)];
  }
}
