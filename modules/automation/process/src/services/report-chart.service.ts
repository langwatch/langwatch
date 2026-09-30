import type {
  AnalyticsTimeseriesInput,
  AnalyticsTimeseriesResult,
} from "@langwatch/analytics-contract";
import {
  ReportIncompleteError,
  type CustomGraph,
  type ReportChart,
  type ReportSource,
} from "@langwatch/automation-contract";
import { customGraphInputSchema, type CustomGraphInput } from "@langwatch/dashboard-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal, toDate, toEpochMs } from "@langwatch/time";

import {
  bucketKeysOf,
  chartTypeOf,
  emptyChartOf,
  pieChartOf,
  seriesInputsOf,
  trendChartOf,
} from "../rules/report-chart.rules.ts";

const logger = createLogger("langwatch:automation:report-chart");

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
  timeScale: CustomGraphInput["timeScale"];
}): string {
  const epochMs = toEpochMs(date);
  if (Number.isNaN(epochMs)) {
    return date;
  }

  const parsed = toDate(Temporal.Instant.fromEpochMilliseconds(epochMs));

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
  findCustomGraph(params: {
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
    for (let index = cursor++; index < items.length; index = cursor++) {
      results[index] = await fn(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

  return results;
}

/** The report's chart panels: what each graph in a source renders for one window. */
export class ReportChartService {
  static create(deps: ReportChartDeps): ReportChartService {
    return new ReportChartService(deps);
  }

  private constructor(private readonly deps: ReportChartDeps) {}

  async loadReportCharts({
    source,
    projectId,
    from,
    to,
  }: {
    source: ReportSource;
    projectId: string;
    from: number;
    to: number;
  }): Promise<ReportChart[]> {
    const deps = this.deps;
    const graphs = await loadGraphs({ deps, source, projectId });

    // Panels are independent queries, so overlap them rather than paying eight
    // round-trips in series — but under a concurrency cap (ADR-044 §5) so a large
    // dashboard doesn't fire every panel's heavy ClickHouse query at once.
    const charts = await mapWithConcurrency(graphs, REPORT_CHART_QUERY_CONCURRENCY, (graph) =>
      buildChart({ deps, graph, projectId, from, to }),
    );
    const delivered = charts.flat();
    // Graphs existed but none could be read: a report that could not be built, not an empty
    // period. Throwing sends the fire through the scheduler's bounded retry (ADR-044).
    if (graphs.length > 0 && delivered.length === 0) throw new ReportIncompleteError();

    return delivered;
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
    const graph = await deps.findCustomGraph({
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
}): Promise<ReportChart[]> {
  const parsed = customGraphInputSchema.safeParse(graph.graph);
  if (!parsed.success) {
    logger.warn(
      { customGraphId: graph.id, projectId },
      "stored graph does not parse as a chart; leaving it out of the report",
    );
    return [];
  }
  const graphData = parsed.data;
  const type = chartTypeOf(graphData.graphType);
  const seriesInputs = seriesInputsOf(graphData);
  const empty = emptyChartOf({ graph, type });
  if (seriesInputs.length === 0) {
    return [empty];
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
    return [empty];
  }

  const bucketKeys = bucketKeysOf(seriesInputs);
  if (type === "pie") {
    return [pieChartOf({ empty, buckets, bucketKeys, seriesInputs, graphData })];
  }

  const timeScale = graphData.timeScale ?? 60;
  const categories = buckets.map((bucket) => formatBucketLabel({ date: bucket.date, timeScale }));

  return [trendChartOf({ empty, buckets, bucketKeys, seriesInputs, graphData, categories })];
}
