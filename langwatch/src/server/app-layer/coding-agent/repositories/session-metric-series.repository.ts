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
}

/** No-op store for deployments without ClickHouse. */
export class NullSessionMetricSeriesRepository
  implements SessionMetricSeriesRepository
{
  async ensure(): Promise<void> {
    // no-op
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
}
