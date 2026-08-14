import type { ReportChart } from "@langwatch/automations/templating/templateContext";
import { createLogger } from "@langwatch/observability";
import type { CustomGraphInput } from "~/components/analytics/CustomGraph";
import {
  resolveGraphTimeScale,
  withGroupedPipeline,
} from "~/features/analytics/logic/graphQueryCompensation";
import type { CustomGraph } from "~/generated/prisma/client";
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
import type { ReportSource } from "~/server/app-layer/automations/report.builder";

const logger = createLogger("langwatch:report-chart");

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

/**
 * A panel's own STORED configuration cannot be evaluated — the graph's
 * stored JSON is the problem (a schema the query layer rejects, an
 * unsupported combination of series options), not a transient failure.
 * Retrying the exact same configuration can never produce a different
 * result, so `buildChartSafely` absorbs ONLY this class: the panel is
 * omitted from the report and logged, the rest of the report still
 * delivers.
 *
 * Every OTHER panel error — a ClickHouse timeout, a connection failure,
 * anything not provably a config problem — is NOT this class and is left to
 * propagate, so it reaches the scheduler's bounded exponential backoff
 * (ADR-044 — "the slot is retried, never silently lost") the same as before
 * per-panel isolation existed. This is the repo's error-handling default:
 * unknown fails toward retry, never toward a false "delivered".
 *
 * A future config-shaped failure (e.g. the query builder's own named error
 * for an unsupported series combination) should throw this class — or a
 * subclass of it — at the point the failure is detected, rather than adding
 * another special case to `buildChartSafely`.
 */
export class TerminalReportPanelError extends Error {
  constructor(
    message: string,
    /** The graph(s) this failure applies to — one for a single panel, every
     *  panel's id when the whole report failed. */
    public readonly graphIds: readonly string[],
  ) {
    super(message);
    this.name = "TerminalReportPanelError";
  }
}

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
function chartTypeOf(
  graphType: CustomGraphInput["graphType"],
): ReportChart["type"] {
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

/**
 * The graph's stored JSON, or a thrown `TerminalReportPanelError` when it is
 * not a usable object — a config problem, not a query one, since retrying
 * the exact same row can never produce a different shape.
 */
function parseGraphConfig(graph: CustomGraph): CustomGraphInput {
  const raw = graph.graph;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TerminalReportPanelError(
      `Graph "${graph.id}" has no usable stored configuration`,
      [graph.id],
    );
  }
  return raw as unknown as CustomGraphInput;
}

/** The "nothing to plot yet" shape for a panel that queried fine but has no
 *  data points for the window. */
function emptyChartFor(
  graph: CustomGraph,
  type: ReportChart["type"],
): ReportChart {
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

/** Slack caps what a chart can carry; past this it stops being readable. */
const MAX_SERIES = 5;
const MAX_SEGMENTS = 8;

/**
 * Max panels a single report queries at once (ADR-044 §5 "Load & scale"). Each
 * panel is one heavy, cold-cache `getTimeseries` GROUP-BY; a large dashboard has
 * dozens, and at a shared schedule boundary several reports on several workers
 * fire together. An unbounded `Promise.all` would fan every panel out at once
 * and a burst of these can exhaust ClickHouse concurrency/memory for interactive
 * traffic. Bounding the per-report fan-out — composed with the worker firing
 * reports one at a time and the fleet's worker count — keeps the burst small
 * while still overlapping enough panels that a dashboard render stays prompt.
 */
export const REPORT_CHART_QUERY_CONCURRENCY = 3;

/**
 * Map `fn` over `items` with at most `concurrency` calls in flight, preserving
 * input order in the result. A rejected `fn` rejects the whole map (matching the
 * previous `Promise.all` all-or-nothing contract — a report either renders every
 * panel or fails and retries via the scheduler's lease).
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

/** Minutes per bucket at or above which a bucket is a whole day. */
const DAY_SCALE_MINUTES = 1440;

const DAY_MS = 24 * 60 * 60 * 1000;

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
  // Panels are independent queries, so overlap them rather than paying eight
  // round-trips in series — but under a concurrency cap (ADR-044 §5) so a large
  // dashboard doesn't fire every panel's heavy ClickHouse query at once.
  const charts = await mapWithConcurrency(
    graphs,
    REPORT_CHART_QUERY_CONCURRENCY,
    (graph) => buildChartSafely({ deps, graph, projectId, from, to }),
  );
  // `null` marks a panel `buildChartSafely` absorbed (TerminalReportPanelError)
  // — it is left out of the report entirely, not delivered as a fake-empty
  // chart. Every other panel error already propagated out of
  // `mapWithConcurrency` and rejected this function before reaching here.
  const delivered = charts.filter(
    (chart): chart is ReportChart => chart !== null,
  );

  // Graphs existed but EVERY one of them had an unrecoverable config
  // problem: that is a report that could not be built, not a period with
  // nothing in it. Throwing sends this fire through the scheduler's bounded
  // retry same as any other failure — a retried-then-failed fire is more
  // honest than delivering a false "Nothing to show for this period."
  if (graphs.length > 0 && delivered.length === 0) {
    throw new TerminalReportPanelError(
      "Every panel in this report failed to evaluate",
      graphs.map((graph) => graph.id),
    );
  }

  return delivered;
}

/**
 * `buildChart`, catching ONLY `TerminalReportPanelError` — a panel whose own
 * stored configuration can never succeed no matter how many times it is
 * retried. That panel is logged and omitted from the report; every other
 * error (unknown, transient, infra) rethrows so it reaches the scheduler's
 * retry path unchanged. See `TerminalReportPanelError` for the reasoning.
 */
async function buildChartSafely(params: {
  deps: ReportChartDeps;
  graph: CustomGraph;
  projectId: string;
  from: number;
  to: number;
}): Promise<ReportChart | null> {
  try {
    return await buildChart(params);
  } catch (error) {
    if (!(error instanceof TerminalReportPanelError)) throw error;

    logger.error(
      { projectId: params.projectId, graphId: params.graph.id, error },
      "Report panel's stored configuration could not be evaluated — omitting it from the report",
    );
    return null;
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
  // Same compensation the analytics UI applies before querying — without it,
  // a summary/pie/donut panel that renders fine on screen comes back with
  // empty buckets in a scheduled report (#6716).
  const graphData = withGroupedPipeline(parseGraphConfig(graph));
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

  const empty = emptyChartFor(graph, type);
  if (seriesInputs.length === 0) return empty;

  // Same "full" forcing the analytics UI applies for summary charts — see
  // `resolveGraphTimeScale`. Reused below for bucket-label formatting too, so
  // the labels describe the resolution actually queried, not the graph's raw
  // stored setting.
  const timeScale = resolveGraphTimeScale({
    graphType: graphData.graphType,
    timeScale: graphData.timeScale ?? 60,
    daysDifference: (to - from) / DAY_MS,
  });

  const timeseries = await deps.getTimeseries({
    projectId,
    startDate: from,
    endDate: to,
    filters: (graph.filters ?? {}) as TimeseriesInputType["filters"],
    series: seriesInputs,
    groupBy: graphData.groupBy,
    timeScale,
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
    isEmpty: series.every((one) =>
      one.data.every((point) => point.value === 0),
    ),
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
