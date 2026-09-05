import type { CustomGraph, ReportChart } from "@langwatch/automation-contract";
import {
  aggregateSeriesValues,
  buildSeriesName,
  extractGroupTotals,
  extractSeriesPoints,
  type AnalyticsSeries,
  type AnalyticsTimeseriesResult,
} from "@langwatch/analytics-contract";

/**
 * The stored graph JSON as a report reads it. The full `CustomGraphInput` is a BROWSER type
 * (colour sets, chart heights, tooltip options) owned by `@langwatch/analytics-web`, and no
 * server module may value-import a browser package.
 */
export interface ReportGraphInput {
  graphType:
    | "line"
    | "bar"
    | "horizontal_bar"
    | "stacked_bar"
    | "area"
    | "stacked_area"
    | "scatter"
    | "pie"
    | "donnut"
    | "summary"
    | "monitor_graph";
  series?: Array<AnalyticsSeries & { name?: string }>;
  groupBy?: string;
  timeScale?: "full" | number;
}

type Buckets = AnalyticsTimeseriesResult["currentPeriod"];

/** Slack caps what a chart can carry; past this it stops being readable. */
const MAX_SERIES = 5;
const MAX_SEGMENTS = 8;

/** Slack renders four chart types; a graph can be any of eleven. Map onto the
 *  nearest one so a stacked bar still arrives as a bar rather than nothing. */
export function chartTypeOf(graphType: ReportGraphInput["graphType"]): ReportChart["type"] {
  switch (graphType) {
    case "pie":
    case "donnut":
      return "pie";
    case "bar":
    case "horizontal_bar":
    case "stacked_bar":
      return "bar";
    case "area":
    case "stacked_area":
      return "area";
    // line / scatter / summary / monitor_graph all read as a trend over time.
    default:
      return "line";
  }
}

/** The series a report queries: the stored panel's own, capped and stripped of display names. */
export function seriesInputsOf(graphData: ReportGraphInput): AnalyticsSeries[] {
  return (graphData.series ?? []).slice(0, MAX_SERIES).map((series) => ({
    metric: series.metric,
    aggregation: series.aggregation,
    key: series.key,
    subkey: series.subkey,
    pipeline: series.pipeline,
    filters: series.filters,
    asPercent: series.asPercent,
  }));
}

/** The panel as it renders with no data behind it, and the base every filled chart spreads. */
export function emptyChartOf({
  graph,
  type,
}: {
  graph: CustomGraph;
  type: ReportChart["type"];
}): ReportChart {
  return {
    id: graph.id,
    title: graph.name,
    type,
    categories: [],
    series: [],
    segments: [],
    total: 0,
    isEmpty: true,
  };
}

/**
 * Result buckets key each series by `buildSeriesName(input, queryIndex)`, NOT by the series'
 * display name — the two encodings differ, and reading by the display name yields zeroes.
 */
export function bucketKeysOf(seriesInputs: AnalyticsSeries[]): string[] {
  return seriesInputs.map((input, index) => buildSeriesName(input, index));
}

/**
 * A pie needs one value per slice, not a value per time bucket. When the graph
 * groups (by model, by user, …), each group is a slice; when it does not, each
 * series is its own slice.
 */
export function pieSegments({
  buckets,
  bucketKeys,
  seriesInputs,
  names,
  groupBy,
}: {
  buckets: Buckets;
  bucketKeys: string[];
  seriesInputs: AnalyticsSeries[];
  names: ReportGraphInput["series"];
  groupBy?: string;
}): Array<{ label: string; value: number }> {
  if (groupBy) {
    return extractGroupTotals(buckets, bucketKeys[0]!, groupBy).filter(
      (segment) => segment.value > 0,
    );
  }

  return seriesInputs
    .map((input, index) => ({
      label: names?.[index]?.name ?? bucketKeys[index]!,
      value: aggregateSeriesValues(
        extractSeriesPoints(buckets, bucketKeys[index]!).map((point) => point.value),
        String(input.aggregation),
        buckets.length,
      ),
    }))
    .filter((segment) => segment.value > 0);
}

export function pieChartOf({
  empty,
  buckets,
  bucketKeys,
  seriesInputs,
  graphData,
}: {
  empty: ReportChart;
  buckets: Buckets;
  bucketKeys: string[];
  seriesInputs: AnalyticsSeries[];
  graphData: ReportGraphInput;
}): ReportChart {
  const segments = pieSegments({
    buckets,
    bucketKeys,
    seriesInputs,
    names: graphData.series ?? [],
    groupBy: graphData.groupBy,
  });
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  return {
    ...empty,
    segments: segments.slice(0, MAX_SEGMENTS),
    total,
    // Slack rejects a pie whose segments are all zero, and a chart of nothing
    // is not worth sending — fall back to the empty-report copy.
    isEmpty: segments.length === 0 || total <= 0,
  };
}

export function trendChartOf({
  empty,
  buckets,
  bucketKeys,
  seriesInputs,
  graphData,
  categories,
}: {
  empty: ReportChart;
  buckets: Buckets;
  bucketKeys: string[];
  seriesInputs: AnalyticsSeries[];
  graphData: ReportGraphInput;
  /** One axis label per bucket; only the caller knows whether a bucket is an hour or a week. */
  categories: string[];
}): ReportChart {
  const series = seriesInputs.map((input, index) => ({
    name: graphData.series?.[index]?.name ?? bucketKeys[index]!,
    data: extractSeriesPoints(buckets, bucketKeys[index]!, graphData.groupBy).map(
      (point, pointIndex) => ({
        label: categories[pointIndex] ?? point.timestamp,
        value: point.value,
      }),
    ),
  }));

  const primary = series[0];
  const total = aggregateSeriesValues(
    primary?.data.map((point) => point.value) ?? [],
    String(graphData.series?.[0]?.aggregation ?? "avg"),
    buckets.length,
  );

  return {
    ...empty,
    categories,
    series,
    total,
    isEmpty: series.every((one) => one.data.every((point) => point.value === 0)),
  };
}
