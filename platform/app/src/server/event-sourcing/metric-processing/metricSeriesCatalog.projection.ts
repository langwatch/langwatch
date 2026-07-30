import { deriveAppendMapping } from "@langwatch/clickhouse";
import { type StampedPoint, stampedPointSchema } from "./metricDataPointStorage.projection";
import type { CanonicalMetricDataPoint } from "./schema";
import { metricSeriesTable } from "./table";

/** The map's whole job: the event's payload already is the row (ADR-105 decision 5). */
export function toMetricSeriesCatalogRow(
  data: CanonicalMetricDataPoint,
): CanonicalMetricDataPoint {
  return data;
}

/** `LastSeenAt` is the table's own engine version — the measurement time, never the write time. */
export const toSeriesRow = deriveAppendMapping<
  StampedPoint,
  typeof metricSeriesTable.columns
>({
  table: metricSeriesTable,
  record: stampedPointSchema,
  fill: {
    LastSeenAt: (point) => new Date(point.timeUnixMs),
    _retention_days: (point) => point.retentionDays,
    _size_bytes: () => 0,
  },
});
