import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { SessionMetricSeriesRecord } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/sessionMetricSeries.mapProjection";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";

const TABLE_NAME = "session_metric_series" as const;

const logger = createLogger(
  "langwatch:app-layer:coding-agent:session-metric-series-repository",
);

/**
 * Persistence for a session's converged metric units (ADR-056 §5, migration
 * 00052). ReplacingMergeTree versioned by AsOf: a re-observed cumulative
 * total writes a newer version of its (TenantId, SessionId, SeriesId) row.
 * Reads dedup by the IN-tuple pattern and SUM per metric — never FINAL,
 * never an increment on insert.
 */
export interface SessionMetricSeriesRepository {
  ensure(
    records: SessionMetricSeriesRecord[],
    retentionDays?: number,
  ): Promise<void>;

  /**
   * Converged totals per (session, metric, bucket) across the deduplicated
   * units — the `SUM ... GROUP BY` read ADR-056 §5 promises. The time range
   * prunes partitions; pass the sessions' era.
   */
  findTotalsBySessionIds(params: {
    tenantId: string;
    sessionIds: string[];
    fromMs: number;
    toMs: number;
  }): Promise<SessionMetricTotal[]>;
}

/** One converged total: a metric's bucket (`type` attribute) per session. */
export interface SessionMetricTotal {
  sessionId: string;
  metricName: string;
  /** The `type` point attribute (`input`, `added`, `user`, …), or "". */
  bucket: string;
  total: number;
}

/** No-op store for deployments without ClickHouse. */
export class NullSessionMetricSeriesRepository
  implements SessionMetricSeriesRepository
{
  async ensure(): Promise<void> {
    // no-op
  }

  async findTotalsBySessionIds(): Promise<SessionMetricTotal[]> {
    return [];
  }
}

interface ClickHouseWriteRecord {
  TenantId: string;
  SessionId: string;
  SeriesId: string;
  MetricName: string;
  MetricUnit: string;
  Agent: string;
  Attributes: Record<string, string>;
  Value: number;
  DataPointCount: number;
  AsOf: Date;
  UpdatedAt: Date;
  _retention_days: number;
}

export class SessionMetricSeriesClickHouseRepository
  implements SessionMetricSeriesRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async ensure(
    records: SessionMetricSeriesRecord[],
    retentionDays?: number,
  ): Promise<void> {
    if (records.length === 0) return;

    const tenantId = records[0]!.tenantId;
    EventUtils.validateTenantId(
      { tenantId },
      "SessionMetricSeriesClickHouseRepository.ensure",
    );
    // A batch insert resolves ONE client, so a row from another tenant would
    // be written into this tenant's ClickHouse. Refuse rather than cross the
    // line.
    for (const record of records) {
      if (record.tenantId !== tenantId) {
        throw new SecurityError(
          "SessionMetricSeriesClickHouseRepository.ensure",
          "session metric series batch spans multiple tenants",
          tenantId,
        );
      }
    }

    const now = new Date();
    const values: ClickHouseWriteRecord[] = records.map((record) => ({
      TenantId: record.tenantId,
      SessionId: record.sessionId,
      SeriesId: record.seriesId,
      MetricName: record.metricName,
      MetricUnit: record.metricUnit,
      Agent: record.agent,
      Attributes: record.attributes,
      Value: record.value,
      DataPointCount: record.dataPointCount,
      AsOf: new Date(record.asOfUnixMs),
      UpdatedAt: now,
      _retention_days: retentionDays ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    }));

    const client = await this.resolveClient(tenantId);
    try {
      await client.insert({
        table: TABLE_NAME,
        values,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
      });
    } catch (error) {
      logger.error(
        { error, tenantId, count: records.length },
        "failed to write session metric series",
      );
      throw error;
    }
  }

  /**
   * `SUM(Value)` per (session, metric, `type` bucket) across units, deduped
   * by the IN-tuple pattern with `max(AsOf)` per unit — never FINAL, and the
   * sum happens strictly AFTER the dedup, so a re-observed cumulative total
   * counts once at its newest value while delta units each count once.
   */
  async findTotalsBySessionIds({
    tenantId,
    sessionIds,
    fromMs,
    toMs,
  }: {
    tenantId: string;
    sessionIds: string[];
    fromMs: number;
    toMs: number;
  }): Promise<SessionMetricTotal[]> {
    if (sessionIds.length === 0) return [];
    EventUtils.validateTenantId(
      { tenantId },
      "SessionMetricSeriesClickHouseRepository.findTotalsBySessionIds",
    );
    const client = await this.resolveClient(tenantId);

    const result = await client.query({
      query: `
        SELECT
          SessionId,
          MetricName,
          Attributes['type'] AS Bucket,
          sum(Value) AS Total
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND SessionId IN {sessionIds:Array(String)}
          AND AsOf BETWEEN fromUnixTimestamp64Milli({from:Int64}) AND fromUnixTimestamp64Milli({to:Int64})
          AND (TenantId, SessionId, SeriesId, AsOf) IN (
            SELECT TenantId, SessionId, SeriesId, max(AsOf)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND SessionId IN {sessionIds:Array(String)}
              AND AsOf BETWEEN fromUnixTimestamp64Milli({from:Int64}) AND fromUnixTimestamp64Milli({to:Int64})
            GROUP BY TenantId, SessionId, SeriesId
          )
        GROUP BY SessionId, MetricName, Bucket
      `,
      query_params: { tenantId, sessionIds, from: fromMs, to: toMs },
      format: "JSONEachRow",
    });

    const rows = await result.json<{
      SessionId: string;
      MetricName: string;
      Bucket: string;
      Total: number;
    }>();
    return rows.map((row) => ({
      sessionId: row.SessionId,
      metricName: row.MetricName,
      bucket: row.Bucket ?? "",
      total: Number(row.Total) || 0,
    }));
  }
}
