import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import type { CodingAgentSessionMetricSeriesRecord } from "@langwatch/coding-agent-contract";
import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { SessionMetricSeriesRepository as MetricSeriesRepository } from "../session-metric-series.repository.ts";
import { clickHouseMomentOf, type ClickHouseMoment } from "./clickhouse.mapper.ts";
import { sessionMetricSeries } from "./clickhouse.session-metric-series.table.ts";

const TABLE_NAME = "session_metric_series" as const;

const logger = createLogger("langwatch:app-layer:coding-agent:session-metric-series-repository");

/** One converged total: a metric's bucket (`type` attribute) per session. */
interface SessionMetricTotal {
  sessionId: string;
  metricName: string;
  /** The `type` point attribute (`input`, `added`, `user`, …), or "". */
  bucket: string;
  total: number;
}

interface ClickHouseWriteRecord {
  [key: string]: unknown;
  TenantId: string;
  SessionId: string;
  SeriesId: string;
  MetricName: string;
  MetricUnit: string;
  Agent: string;
  Attributes: Record<string, string>;
  Value: number;
  DataPointCount: number;
  AsOf: ClickHouseMoment;
  UpdatedAt: ClickHouseMoment;
  _retention_days: number;
}

export class SessionMetricSeriesClickHouseRepository implements MetricSeriesRepository {
  static create({
    clickhouse,
    defaultTraceRetentionDays,
  }: {
    clickhouse: Pick<ClickHouseQueryClient, "read" | "insert">;
    defaultTraceRetentionDays: number;
  }): SessionMetricSeriesClickHouseRepository {
    return new SessionMetricSeriesClickHouseRepository(clickhouse, defaultTraceRetentionDays);
  }

  private constructor(
    private readonly clickhouse: Pick<ClickHouseQueryClient, "read" | "insert">,
    private readonly defaultTraceRetentionDays: number,
  ) {}

  async ensure(
    records: CodingAgentSessionMetricSeriesRecord[],
    retentionDays?: number,
  ): Promise<void> {
    const [first] = records;
    if (!first) return;

    const tenantId = first.tenantId;
    EventUtils.validateTenantId({ tenantId }, "SessionMetricSeriesClickHouseRepository.ensure");
    // A batch is written for ONE tenant, so a row from another would land in
    // this tenant's ClickHouse. Refuse rather than cross the line.
    for (const record of records) {
      if (record.tenantId !== tenantId) {
        throw new SecurityError({
          operation: "SessionMetricSeriesClickHouseRepository.ensure",
          message: "session metric series batch spans multiple tenants",
          tenantId,
        });
      }
    }

    const now = clickHouseMomentOf(nowInstant().epochMilliseconds);
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
      AsOf: clickHouseMomentOf(record.asOfUnixMs),
      UpdatedAt: now,
      _retention_days: retentionDays ?? this.defaultTraceRetentionDays,
    }));

    try {
      await this.clickhouse.insert({
        tenantId,
        table: TABLE_NAME,
        rows: values,
        settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.warn(
        { error, tenantId, count: records.length },
        "failed to write session metric series",
      );
      throw error;
    }
  }

  /**
   * `SUM(Value)` per (session, metric, `type` bucket) across units, deduped by the IN-tuple
   * pattern with `max(AsOf)` per unit — never FINAL, and the sum happens strictly AFTER the
   * dedup, so a re-observed cumulative total counts once at its newest value while delta
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
    // Converge each unit FIRST (argMax by AsOf per SeriesId), then sum the converged values.
    // An IN-tuple filter on (SeriesId, max(AsOf)) is not enough here: a byte-identical
    // re-delivery leaves two un-merged rows sharing the winning AsOf, both pass the filter,
    // and a plain sum counts the unit twice. UpdatedAt breaks AsOf ties so a same-timestamp
    // correction converges on the newest write instead of an arbitrary row.
    const t = sessionMetricSeries;
    const scope = tenantScope.single({ tenantId });
    const bucket = fn.mapGet(t.Attributes, "type");
    const units = clickhouseRead({ scope })
      .from(t)
      .select({
        SessionId: t.SessionId,
        MetricName: t.MetricName,
        Bucket: bucket,
        SeriesValue: fn.argMax(t.Value, fn.tuple(t.AsOf, t.UpdatedAt)),
      })
      .where(({ and, gte, lte, oneOf }) =>
        and(oneOf(t.SessionId, sessionIds), gte(t.AsOf, fromMs), lte(t.AsOf, toMs)),
      )
      .groupBy(t.TenantId)
      .groupBy(t.SessionId)
      .groupBy(t.SeriesId)
      .groupBy(t.MetricName)
      .groupBy(bucket)
      .as("units");
    const statement = clickhouseRead({ scope })
      .from(units)
      .select({
        SessionId: units.SessionId,
        MetricName: units.MetricName,
        Bucket: units.Bucket,
        Total: fn.sum(units.SeriesValue),
      })
      .groupBy(units.SessionId)
      .groupBy(units.MetricName)
      .groupBy(units.Bucket)
      .build();
    const { rows } = await this.clickhouse.read({ statement });

    return rows.map((row) => ({
      sessionId: row.SessionId,
      metricName: row.MetricName,
      bucket: row.Bucket ?? "",
      total: Number(row.Total) || 0,
    }));
  }
}
