import { deriveAppendMapping } from "@langwatch/clickhouse";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { MetricFactsContribution, SessionMetricSeriesRecord } from "./schema";
import { sessionMetricSeriesRecordSchema } from "./schema";
import { sessionMetricSeriesTable } from "./table";

/**
 * The attribute keys the session read actually consumes (the overlay's
 * `type` / `decision` / `language` dimensions). Series identity is already
 * fixed upstream in `seriesId`, so persisting anything beyond these would
 * only copy provider-supplied attributes — which can carry identity like
 * `user.id` / `user.email` — verbatim into a durable table.
 */
const PERSISTED_ATTRIBUTE_KEYS = new Set(["type", "decision", "language"]);

export function mapSessionMetricSeries(
  data: MetricFactsContribution,
): SessionMetricSeriesRecord {
  return {
    tenantId: data.tenantId,
    sessionId: data.sessionId,
    seriesId: data.seriesId,
    metricName: data.metricName,
    metricUnit: data.unit ?? "",
    agent: data.agent,
    attributes: Object.fromEntries(
      Object.entries(data.attributes)
        .filter(([key]) => PERSISTED_ATTRIBUTE_KEYS.has(key))
        .map(([key, value]) => [key, String(value)]),
    ),
    value: data.value,
    dataPointCount: data.dataPointCount,
    asOfUnixMs: data.asOfUnixMs,
  };
}

export const toSessionMetricSeriesRow = deriveAppendMapping<
  SessionMetricSeriesRecord,
  typeof sessionMetricSeriesTable.columns
>({
  table: sessionMetricSeriesTable,
  record: sessionMetricSeriesRecordSchema,
  fill: {
    AsOf: (record) => new Date(record.asOfUnixMs),
    UpdatedAt: () => new Date(),
    _retention_days: (_record, context) =>
      context.retentionDays ?? PLATFORM_DEFAULT_RETENTION_DAYS,
  },
});
