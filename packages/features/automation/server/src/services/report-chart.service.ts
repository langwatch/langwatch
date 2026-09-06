import type { CustomGraph, ReportChart, ReportSource } from "@langwatch/automation-contract";
import type {
  AnalyticsTimeseriesInput,
  AnalyticsTimeseriesResult,
} from "@langwatch/analytics-contract";
import {
  bucketKeysOf,
  chartTypeOf,
  emptyChartOf,
  pieChartOf,
  seriesInputsOf,
  trendChartOf,
  type ReportGraphInput,
} from "../rules/report-chart.rules.ts";

/** Minutes per bucket at or above which a bucket is a whole day. */
const DAY_SCALE_MINUTES = 1440;

/**
 * Axis label for one time bucket. The TEMPLATE cannot do this — it has no idea whether a bucket
 * is an hour or a week, so it would render every daily bucket as "00:00". The scale is known
 * here, so the label is resolved here and the template just prints it.
 */
function formatBucketLabel({
  date,
  timeScale,
}: {
  date: string;
  timeScale: ReportGraphInput["timeScale"];
}): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  const daily = timeScale === "full" || Number(timeScale) >= DAY_SCALE_MINUTES;

  return parsed.toLocaleString("en-US", {
    timeZone: "UTC",
    ...(daily
      ? { month: "short", day: "2-digit" }
      : { hour: "2-digit", minute: "2-digit", hour12: false }),
  });
}

/**
 * Turn a report's chart source — one custom graph, or every panel on a dashboard — into the
 * `ReportChart[]` the template context carries.
 */

export interface ReportChartDeps {
  loadCustomGraph(params: {
    projectId: string;
    customGraphId: string;
  }): Promise<CustomGraph | null>;
  /** Every panel on a dashboard, in the dashboard's own grid order. */
  loadDashboardGraphs(params: { projectId: string; dashboardId: string }): Promise<CustomGraph[]>;
  getTimeseries(input: AnalyticsTimeseriesInput): Promise<AnalyticsTimeseriesResult>;
}

/**
 * Max panels a single report queries at once (ADR-044 §5 "Load & scale"). Each
 */
export const REPORT_CHART_QUERY_CONCURRENCY = 3;

/**
 * Map `fn` over `items` with at most `concurrency` calls in flight, preserving input order in
 * the result.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  results.length = items.length;

  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) {
        return;
      }

      results[index] = await fn(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

  return results;
}

/** The report's chart panels: what each graph in a source renders for one window. */
export class ReportChartService {
  static create(): ReportChartService {
    return new ReportChartService();
  }

  static async loadReportCharts({
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

    // Panels are independent queries, so overlap them rather than paying eight
    // round-trips in series — but under a concurrency cap (ADR-044 §5) so a large
    // dashboard doesn't fire every panel's heavy ClickHouse query at once.
    return mapWithConcurrency(graphs, REPORT_CHART_QUERY_CONCURRENCY, (graph) =>
      buildChart({ deps, graph, projectId, from, to }),
    );
  }
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
  const graphData = graph.graph as unknown as ReportGraphInput;
  const type = chartTypeOf(graphData.graphType);
  const seriesInputs = seriesInputsOf(graphData);
  const empty = emptyChartOf({ graph, type });
  if (seriesInputs.length === 0) {
    return empty;
  }

  const timeseries = await deps.getTimeseries({
    projectId,
    startDate: from,
    endDate: to,
    filters: (graph.filters ?? {}) as AnalyticsTimeseriesInput["filters"],
    series: seriesInputs,
    groupBy: graphData.groupBy,
    timeScale: graphData.timeScale ?? 60,
    // A report renders in the project's own frame; the scheduler already fires
    // in the report's timezone, so the buckets only need to be stable.
    timeZone: "UTC",
  });

  const buckets = timeseries.currentPeriod;
  if (buckets.length === 0) {
    return empty;
  }

  const bucketKeys = bucketKeysOf(seriesInputs);
  if (type === "pie") {
    return pieChartOf({ empty, buckets, bucketKeys, seriesInputs, graphData });
  }

  const timeScale = graphData.timeScale ?? 60;
  const categories = buckets.map((bucket) => formatBucketLabel({ date: bucket.date, timeScale }));

  return trendChartOf({ empty, buckets, bucketKeys, seriesInputs, graphData, categories });
}
