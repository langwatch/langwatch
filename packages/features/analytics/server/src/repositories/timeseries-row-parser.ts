import {
  analyticsTimeseriesRowSchema,
  buildSeriesName,
  type AnalyticsSeries,
  type AnalyticsTimeseriesResult,
} from "@langwatch/analytics-contract";

const aliasFor = (index: number, series: AnalyticsSeries): string => {
  const parts = [
    String(index),
    series.metric.replace(/\./g, "_"),
    series.aggregation,
  ];
  if (series.key) parts.push(series.key.replace(/[^a-zA-Z0-9]/g, "_"));
  if (series.subkey) parts.push(series.subkey.replace(/[^a-zA-Z0-9]/g, "_"));
  return parts.join("__");
};

const numberOrNull = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const zeroWhenAbsent = (series: AnalyticsSeries): boolean =>
  series.pipeline
    ? series.pipeline.aggregation === "sum"
    : series.aggregation === "cardinality" ||
      series.aggregation === "terms" ||
      series.aggregation === "sum";

/** Decode JSONEachRow without allowing malformed cells to become analytics. */
export function parseTimeseriesRows(input: {
  readonly rows: readonly unknown[];
  readonly series: readonly AnalyticsSeries[];
  readonly groupBy: string | undefined;
  readonly timeScale: number | "full" | undefined;
}): AnalyticsTimeseriesResult {
  const rows = input.rows.map((row) => analyticsTimeseriesRowSchema.parse(row));
  const current = new Map<string, Record<string, unknown>>();
  const previous = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    const period = row.period === "current" ? current : previous;
    const date =
      input.timeScale === "full"
        ? "full"
        : typeof row.date === "string"
          ? row.date
          : "";
    const bucket = period.get(date) ?? { date };
    period.set(date, bucket);
    const grouped =
      input.groupBy && row.group_key !== undefined && row.group_key !== null;
    const target = grouped
      ? ((bucket[input.groupBy!] ??= {}) as Record<
          string,
          Record<string, number>
        >)[String(row.group_key)] ??= {}
      : bucket;
    for (const [index, series] of input.series.entries()) {
      const value = numberOrNull(row[aliasFor(index, series)]);
      if (value !== null) target[buildSeriesName(series, index)] = value;
    }
  }

  const sorted = (period: Map<string, Record<string, unknown>>) =>
    [...period.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, bucket]) => bucket);
  const currentPeriod = sorted(current);
  const previousPeriod = sorted(previous).slice(
    Math.max(0, previous.size - current.size),
  );
  const zeroKeys = input.series
    .map((series, index) =>
      zeroWhenAbsent(series) ? buildSeriesName(series, index) : null,
    )
    .filter((key): key is string => key !== null);
  for (const bucket of [...previousPeriod, ...currentPeriod]) {
    for (const key of zeroKeys) {
      if (input.groupBy) {
        const groups = bucket[input.groupBy] as
          | Record<string, Record<string, number>>
          | undefined;
        for (const metrics of Object.values(groups ?? {})) {
          metrics[key] ??= 0;
        }
      } else {
        bucket[key] ??= 0;
      }
    }
  }
  return { previousPeriod, currentPeriod } as AnalyticsTimeseriesResult;
}
