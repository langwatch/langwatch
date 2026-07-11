import type { CustomGraph } from "@prisma/client";
import type { CustomGraphInput } from "~/components/analytics/CustomGraph";
import type {
  SeriesInputType,
  TimeseriesInputType,
} from "~/server/analytics/registry";
import type { TimeseriesResult } from "~/server/analytics/types";
import { buildSeriesName } from "~/server/app-layer/analytics/repositories/_timeseries-row-parser";
import {
  aggregateSeriesValues,
  extractGroupTotals,
  extractSeriesPoints,
} from "~/server/app-layer/analytics/series-points";
import type { ReportSource } from "~/server/app-layer/triggers/report.builder";
import type { ReportChart } from "~/shared/templating/templateContext";

/**
 * Turn a report's chart source — one custom graph, or every panel on a
 * dashboard — into the `ReportChart[]` the template context carries.
 *
 * The graph's stored JSON is the same `CustomGraphInput` the analytics UI
 * draws from, so a report renders exactly the series the author sees on the
 * dashboard, over the report's own window rather than the UI's date picker.
 * Unlike the graph-alert evaluator (which watches ONE series against a
 * threshold), a report plots every series on the graph.
 */

export interface ReportChartDeps {
  loadCustomGraph(params: {
    projectId: string;
    customGraphId: string;
  }): Promise<CustomGraph | null>;
  /** Every panel on a dashboard, in the dashboard's own grid order. */
  loadDashboardGraphs(params: {
    projectId: string;
    dashboardId: string;
  }): Promise<CustomGraph[]>;
  getTimeseries(input: TimeseriesInputType): Promise<TimeseriesResult>;
}

/** Slack renders four chart types; a graph can be any of eleven. Map onto the
 *  nearest one so a stacked bar still arrives as a bar rather than nothing. */
function chartTypeOf(graphType: CustomGraphInput["graphType"]): ReportChart["type"] {
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

/** Slack caps what a chart can carry; past this it stops being readable. */
const MAX_SERIES = 5;
const MAX_SEGMENTS = 8;

/** Minutes per bucket at or above which a bucket is a whole day. */
const DAY_SCALE_MINUTES = 1440;

/**
 * Axis label for one time bucket. The TEMPLATE cannot do this — it has no idea
 * whether a bucket is an hour or a week, so it would render every daily bucket
 * as "00:00". The scale is known here, so the label is resolved here and the
 * template just prints it.
 */
function formatBucketLabel({
  date,
  timeScale,
}: {
  date: string;
  timeScale: CustomGraphInput["timeScale"];
}): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  const daily = timeScale === "full" || Number(timeScale) >= DAY_SCALE_MINUTES;
  return parsed.toLocaleString("en-US", {
    timeZone: "UTC",
    ...(daily
      ? { month: "short", day: "2-digit" }
      : { hour: "2-digit", minute: "2-digit", hour12: false }),
  });
}

export async function loadReportCharts({
  deps,
  source,
  projectId,
  from,
  to,
}: {
  deps: ReportChartDeps;
  source: ReportSource;
  projectId: string;
  from: number;
  to: number;
}): Promise<ReportChart[]> {
  const graphs = await loadGraphs({ deps, source, projectId });
  // Panels are independent queries; a dashboard with eight of them should not
  // take eight round-trips in series.
  return Promise.all(
    graphs.map((graph) => buildChart({ deps, graph, projectId, from, to })),
  );
}

async function loadGraphs({
  deps,
  source,
  projectId,
}: {
  deps: ReportChartDeps;
  source: ReportSource;
  projectId: string;
}): Promise<CustomGraph[]> {
  if (source.kind === "customGraph") {
    const graph = await deps.loadCustomGraph({
      projectId,
      customGraphId: source.customGraphId,
    });
    return graph ? [graph] : [];
  }
  if (source.kind === "dashboard") {
    return deps.loadDashboardGraphs({
      projectId,
      dashboardId: source.dashboardId,
    });
  }
  return [];
}

async function buildChart({
  deps,
  graph,
  projectId,
  from,
  to,
}: {
  deps: ReportChartDeps;
  graph: CustomGraph;
  projectId: string;
  from: number;
  to: number;
}): Promise<ReportChart> {
  const graphData = graph.graph as unknown as CustomGraphInput;
  const type = chartTypeOf(graphData.graphType);
  const seriesInputs: SeriesInputType[] = (graphData.series ?? [])
    .slice(0, MAX_SERIES)
    .map((series) => ({
      metric: series.metric,
      aggregation: series.aggregation,
      key: series.key,
      subkey: series.subkey,
      pipeline: series.pipeline,
      filters: series.filters,
      asPercent: series.asPercent,
    }));

  const empty: ReportChart = {
    id: graph.id,
    title: graph.name,
    type,
    categories: [],
    series: [],
    segments: [],
    total: 0,
    isEmpty: true,
  };
  if (seriesInputs.length === 0) return empty;

  const timeseries = await deps.getTimeseries({
    projectId,
    startDate: from,
    endDate: to,
    filters: (graph.filters ?? {}) as TimeseriesInputType["filters"],
    series: seriesInputs,
    groupBy: graphData.groupBy,
    timeScale: graphData.timeScale ?? 60,
    // A report renders in the project's own frame; the scheduler already fires
    // in the report's timezone, so the buckets only need to be stable.
    timeZone: "UTC",
  });

  const buckets = timeseries.currentPeriod;
  if (buckets.length === 0) return empty;

  // Result buckets key each series by `buildSeriesName(input, queryIndex)`, NOT
  // by the series' display name — the two encodings differ, and reading by the
  // display name silently yields zeroes.
  const bucketKeys = seriesInputs.map((input, index) =>
    buildSeriesName(input, index),
  );

  if (type === "pie") {
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

  const timeScale = graphData.timeScale ?? 60;
  const categories = buckets.map((bucket) =>
    formatBucketLabel({ date: bucket.date, timeScale }),
  );
  const series = seriesInputs.map((input, index) => ({
    name: graphData.series?.[index]?.name ?? bucketKeys[index]!,
    data: extractSeriesPoints(
      buckets,
      bucketKeys[index]!,
      graphData.groupBy,
    ).map((point, pointIndex) => ({
      label: categories[pointIndex] ?? point.timestamp,
      value: point.value,
    })),
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

/**
 * A pie needs one value per slice, not a value per time bucket. When the graph
 * groups (by model, by user, …), each group is a slice; when it does not, each
 * series is its own slice.
 */
function pieSegments({
  buckets,
  bucketKeys,
  seriesInputs,
  names,
  groupBy,
}: {
  buckets: TimeseriesResult["currentPeriod"];
  bucketKeys: string[];
  seriesInputs: SeriesInputType[];
  names: CustomGraphInput["series"];
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
        extractSeriesPoints(buckets, bucketKeys[index]!).map(
          (point) => point.value,
        ),
        String(input.aggregation),
        buckets.length,
      ),
    }))
    .filter((segment) => segment.value > 0);
}
