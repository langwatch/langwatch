import type { AnalyticsTimeseriesResult } from "@langwatch/analytics-contract";
import { buildSeriesName } from "@langwatch/analytics-contract";
import type { ReportSource } from "@langwatch/automation-contract";
import type { CustomGraph } from "@langwatch/prisma-client/generated";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loggerWarn } = vi.hoisted(() => ({ loggerWarn: vi.fn() }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: loggerWarn, error: vi.fn() }),
}));

import {
  ReportChartService,
  REPORT_CHART_QUERY_CONCURRENCY,
  type ReportChartDeps,
} from "../report-chart.service.ts";

const COUNT_SERIES = {
  metric: "metadata.trace_id",
  aggregation: "cardinality",
  name: "Traces",
  colorSet: "colors",
};
/** The bucket key the timeseries result really uses — NOT the display name. */
const COUNT_KEY = buildSeriesName(COUNT_SERIES as never, 0);
/** The key once `withGroupedPipeline` injects its default pipeline into a grouped pie. */
const PIPED_COUNT_KEY = `${COUNT_KEY}/trace_id/sum`;
/** One stored series as the graph's JSON column carries it. */
type StoredSeries = { [key: string]: string | { field: string; aggregation: string } };

function makeGraph(overrides: Partial<CustomGraph> = {}): CustomGraph {
  return {
    id: "graph-1",
    name: "Traces per hour",
    projectId: "proj-1",
    filters: {},
    kind: "builder",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    dashboardId: null,
    gridColumn: 0,
    gridRow: 0,
    colSpan: 1,
    rowSpan: 1,
    graph: {
      graphId: "graph-1",
      graphType: "line",
      series: [COUNT_SERIES],
      includePrevious: false,
      timeScale: 60,
    },
    ...overrides,
  };
}

function makeDeps({
  graphs,
  timeseries,
}: {
  graphs: CustomGraph[];
  timeseries: AnalyticsTimeseriesResult;
}) {
  return {
    findCustomGraph: vi.fn(async () => graphs[0] ?? null),
    loadDashboardGraphs: vi.fn(async () => graphs),
    getTimeseries: vi.fn(async () => timeseries),
  } satisfies ReportChartDeps;
}

const WINDOW = { from: 0, to: 3_600_000 };

function run({ deps, source }: { deps: ReportChartDeps; source: ReportSource }) {
  return ReportChartService.create(deps).loadReportCharts({
    source,
    projectId: "proj-1",
    ...WINDOW,
  });
}

describe("ReportChartService.loadReportCharts", () => {
  describe("given a customGraph report", () => {
    it("plots the graph's series over the report window", async () => {
      const deps = makeDeps({
        graphs: [makeGraph()],
        timeseries: {
          previousPeriod: [],
          currentPeriod: [
            { date: "2026-07-11T09:00:00Z", [COUNT_KEY]: 3 },
            { date: "2026-07-11T10:00:00Z", [COUNT_KEY]: 7 },
          ],
        },
      });

      const [chart] = await run({
        deps,
        source: { kind: "customGraph", customGraphId: "graph-1" },
      });

      expect(chart!.title).toBe("Traces per hour");
      expect(chart!.type).toBe("line");
      expect(chart!.isEmpty).toBe(false);
      expect(chart!.series).toHaveLength(1);
      expect(chart!.series[0]!.data.map((p) => p.value)).toEqual([3, 7]);
      // Categories are display labels, resolved here because the template has
      // no idea whether a bucket is an hour or a day.
      expect(chart!.categories).toEqual(["09:00", "10:00"]);
      // A count sums across the window.
      expect(chart!.total).toBe(10);
    });

    describe("when the graph returns no buckets", () => {
      it("marks the chart empty rather than inventing a flat line", async () => {
        const deps = makeDeps({
          graphs: [makeGraph()],
          timeseries: { previousPeriod: [], currentPeriod: [] },
        });

        const [chart] = await run({
          deps,
          source: { kind: "customGraph", customGraphId: "graph-1" },
        });

        expect(chart!.isEmpty).toBe(true);
        expect(chart!.series).toEqual([]);
      });
    });

    describe("when every bucket is zero", () => {
      it("marks the chart empty", async () => {
        const deps = makeDeps({
          graphs: [makeGraph()],
          timeseries: {
            previousPeriod: [],
            currentPeriod: [
              { date: "2026-07-11T09:00:00Z", [COUNT_KEY]: 0 },
              { date: "2026-07-11T10:00:00Z", [COUNT_KEY]: 0 },
            ],
          },
        });

        const [chart] = await run({
          deps,
          source: { kind: "customGraph", customGraphId: "graph-1" },
        });

        expect(chart!.isEmpty).toBe(true);
      });
    });

    describe("when the graph is missing", () => {
      it("returns no charts", async () => {
        const deps = makeDeps({
          graphs: [],
          timeseries: { previousPeriod: [], currentPeriod: [] },
        });
        const charts = await run({
          deps,
          source: { kind: "customGraph", customGraphId: "gone" },
        });
        expect(charts).toEqual([]);
      });
    });
  });

  describe("given a grouped line graph whose series is an average", () => {
    it("plots the series' own value rather than the groups added together", async () => {
      const avgSeries = {
        metric: "performance.completion_time",
        aggregation: "avg",
        name: "Average completion time",
        colorSet: "colors",
      };
      const avgKey = buildSeriesName(avgSeries as never, 0);
      const getTimeseries = vi.fn(async (input: { groupBy?: string }) =>
        input.groupBy
          ? ({
              previousPeriod: [],
              currentPeriod: [
                {
                  date: "2026-07-11T09:00:00Z",
                  "traces.trace_name": {
                    checkout: { [avgKey]: 100 },
                    search: { [avgKey]: 200 },
                  },
                },
              ],
            } satisfies AnalyticsTimeseriesResult)
          : ({
              previousPeriod: [],
              currentPeriod: [{ date: "2026-07-11T09:00:00Z", [avgKey]: 150 }],
            } satisfies AnalyticsTimeseriesResult),
      );
      const deps: ReportChartDeps = {
        ...makeDeps({
          graphs: [
            makeGraph({
              graph: {
                graphId: "graph-1",
                graphType: "line",
                series: [avgSeries],
                groupBy: "traces.trace_name",
                includePrevious: false,
                timeScale: 60,
              },
            }),
          ],
          timeseries: { previousPeriod: [], currentPeriod: [] },
        }),
        getTimeseries,
      };

      const [chart] = await run({
        deps,
        source: { kind: "customGraph", customGraphId: "graph-1" },
      });

      expect(chart!.series[0]!.data.map((p) => p.value)).toEqual([150]);
      expect(chart!.total).toBe(150);
      expect(getTimeseries.mock.calls[0]![0].groupBy).toBeUndefined();
    });
  });

  describe("given a grouped pie graph", () => {
    it("makes one slice per group, largest first", async () => {
      const deps = makeDeps({
        graphs: [
          makeGraph({
            name: "Traces by model",
            graph: {
              graphId: "graph-1",
              graphType: "donnut",
              series: [COUNT_SERIES],
              groupBy: "metadata.model",
              includePrevious: false,
              timeScale: 60,
            },
          }),
        ],
        timeseries: {
          previousPeriod: [],
          currentPeriod: [
            {
              date: "2026-07-11T09:00:00Z",
              "metadata.model": {
                "gpt-5-mini": { [PIPED_COUNT_KEY]: 2 },
                "claude-opus-4-8": { [PIPED_COUNT_KEY]: 5 },
              },
            },
          ],
        },
      });

      const [chart] = await run({
        deps,
        source: { kind: "customGraph", customGraphId: "graph-1" },
      });

      // donnut maps onto the nearest type Slack renders.
      expect(chart!.type).toBe("pie");
      expect(chart!.segments).toEqual([
        { label: "claude-opus-4-8", value: 5 },
        { label: "gpt-5-mini", value: 2 },
      ]);
      expect(chart!.series).toEqual([]);
      expect(chart!.total).toBe(7);
      // Slices come from the groups, so a pie is the one chart that still
      // asks the timeseries for them.
      expect(deps.getTimeseries).toHaveBeenCalledWith(
        expect.objectContaining({ groupBy: "metadata.model" }),
      );
    });
  });

  describe("given a summary panel", () => {
    it("queries with the full time scale, matching what the dashboard UI renders", async () => {
      const deps = makeDeps({
        graphs: [
          makeGraph({
            name: "Total traces",
            graph: {
              graphId: "graph-1",
              graphType: "summary",
              series: [COUNT_SERIES],
              includePrevious: false,
              timeScale: 60,
            },
          }),
        ],
        timeseries: {
          previousPeriod: [],
          currentPeriod: [{ date: "2026-07-11T09:00:00Z", [COUNT_KEY]: 42 }],
        },
      });

      const [chart] = await run({
        deps,
        source: { kind: "customGraph", customGraphId: "graph-1" },
      });

      expect(deps.getTimeseries).toHaveBeenCalledWith(
        expect.objectContaining({ timeScale: "full" }),
      );
      expect(chart?.isEmpty).toBe(false);
    });
  });

  describe("given a grouped pie graph with no pipeline of its own", () => {
    const groupedPie = (series: StoredSeries[]) =>
      makeDeps({
        graphs: [
          makeGraph({
            graph: {
              graphId: "graph-1",
              graphType: "pie",
              series,
              groupBy: "metadata.model",
              includePrevious: false,
              timeScale: 60,
            },
          }),
        ],
        timeseries: { previousPeriod: [], currentPeriod: [] },
      });

    it("queries with the default pipeline the backend needs to populate grouped buckets", async () => {
      const deps = groupedPie([COUNT_SERIES]);

      await run({ deps, source: { kind: "customGraph", customGraphId: "graph-1" } });

      expect(deps.getTimeseries).toHaveBeenCalledWith(
        expect.objectContaining({
          series: [
            expect.objectContaining({ pipeline: { field: "trace_id", aggregation: "sum" } }),
          ],
        }),
      );
    });

    describe("when the graph already defines its own pipeline", () => {
      it("leaves the author's pipeline alone", async () => {
        const deps = groupedPie([
          { ...COUNT_SERIES, pipeline: { field: "trace_id", aggregation: "avg" } },
        ]);

        await run({ deps, source: { kind: "customGraph", customGraphId: "graph-1" } });

        expect(deps.getTimeseries).toHaveBeenCalledWith(
          expect.objectContaining({
            series: [
              expect.objectContaining({ pipeline: { field: "trace_id", aggregation: "avg" } }),
            ],
          }),
        );
      });
    });
  });

  describe("given a dashboard whose panels genuinely have data", () => {
    /** @scenario "A dashboard report with data delivers per-panel content" */
    it("delivers real content for a summary panel and a grouped pie panel alike", async () => {
      const deps = makeDeps({
        graphs: [
          makeGraph({
            id: "summary-graph",
            name: "Total traces",
            graph: {
              graphId: "summary-graph",
              graphType: "summary",
              series: [COUNT_SERIES],
              includePrevious: false,
              timeScale: 60,
            },
          }),
          makeGraph({
            id: "pie-graph",
            name: "Traces by model",
            graph: {
              graphId: "pie-graph",
              graphType: "donnut",
              series: [COUNT_SERIES],
              groupBy: "metadata.model",
              includePrevious: false,
              timeScale: 60,
            },
          }),
        ],
        timeseries: {
          previousPeriod: [],
          currentPeriod: [
            {
              date: "2026-07-11T09:00:00Z",
              [COUNT_KEY]: 9,
              "metadata.model": {
                "gpt-5-mini": { [PIPED_COUNT_KEY]: 6 },
                "claude-opus-4-8": { [PIPED_COUNT_KEY]: 3 },
              },
            },
          ],
        },
      });

      const [summary, pie] = await run({
        deps,
        source: { kind: "dashboard", dashboardId: "dash-1" },
      });

      expect(summary?.isEmpty).toBe(false);
      expect(summary?.series[0]?.data.map((point) => point.value)).toEqual([9]);
      expect(pie?.isEmpty).toBe(false);
      expect(pie?.segments).toEqual([
        { label: "gpt-5-mini", value: 6 },
        { label: "claude-opus-4-8", value: 3 },
      ]);
    });
  });

  describe("given the period genuinely has no data", () => {
    /** @scenario "'Nothing to show' appears only when the period is genuinely empty" */
    it("marks a graph with no series configured empty, without running a query", async () => {
      const deps = makeDeps({
        graphs: [
          makeGraph({
            graph: {
              graphId: "graph-1",
              graphType: "line",
              series: [],
              includePrevious: false,
              timeScale: 60,
            },
          }),
        ],
        timeseries: { previousPeriod: [], currentPeriod: [] },
      });

      const [chart] = await run({
        deps,
        source: { kind: "customGraph", customGraphId: "graph-1" },
      });

      expect(chart?.isEmpty).toBe(true);
      expect(deps.getTimeseries).not.toHaveBeenCalled();
    });
  });

  describe("given a dashboard report", () => {
    it("returns one chart per panel", async () => {
      const deps = makeDeps({
        graphs: [
          makeGraph({ id: "graph-1", name: "Panel one" }),
          makeGraph({ id: "graph-2", name: "Panel two" }),
        ],
        timeseries: {
          previousPeriod: [],
          currentPeriod: [{ date: "2026-07-11T09:00:00Z", [COUNT_KEY]: 4 }],
        },
      });

      const charts = await run({
        deps,
        source: { kind: "dashboard", dashboardId: "dash-1" },
      });

      expect(charts.map((c) => c.title)).toEqual(["Panel one", "Panel two"]);
      expect(deps.loadDashboardGraphs).toHaveBeenCalledWith({
        projectId: "proj-1",
        dashboardId: "dash-1",
      });
    });
  });

  describe("given a dashboard with a panel whose stored graph does not parse", () => {
    beforeEach(() => loggerWarn.mockClear());

    /** @scenario "A panel whose configuration cannot be evaluated is left out; the report still delivers" */
    it("leaves that panel out, names it in a warning, and renders the rest", async () => {
      const deps = makeDeps({
        graphs: [
          makeGraph({ id: "graph-1", name: "Panel one" }),
          makeGraph({ id: "graph-broken", name: "Broken", graph: { graphType: "line" } }),
        ],
        timeseries: {
          previousPeriod: [],
          currentPeriod: [{ date: "2026-07-11T09:00:00Z", [COUNT_KEY]: 4 }],
        },
      });

      const charts = await run({
        deps,
        source: { kind: "dashboard", dashboardId: "dash-1" },
      });

      expect(charts.map((c) => c.title)).toEqual(["Panel one"]);
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ customGraphId: "graph-broken" }),
        expect.any(String),
      );
    });
  });

  describe("given every panel's stored configuration is unusable", () => {
    /** @scenario "All panels failing retries rather than delivering a false empty report" */
    it("rejects rather than deliver a false 'nothing to show'", async () => {
      const deps = makeDeps({
        graphs: [
          makeGraph({ id: "graph-a", graph: { graphType: "line" } }),
          makeGraph({ id: "graph-b", graph: { graphType: "line" } }),
        ],
        timeseries: { previousPeriod: [], currentPeriod: [] },
      });

      await expect(
        run({ deps, source: { kind: "dashboard", dashboardId: "dash-1" } }),
      ).rejects.toMatchObject({ code: "report_incomplete" });
    });
  });

  describe("given one panel's query fails with an unknown, non-config error", () => {
    /** @scenario "An unknown panel failure retries the whole report" */
    it("rejects rather than deliver a report with the panel silently missing", async () => {
      const deps = {
        ...makeDeps({
          graphs: [makeGraph({ id: "graph-1" }), makeGraph({ id: "graph-2" })],
          timeseries: { previousPeriod: [], currentPeriod: [] },
        }),
        getTimeseries: vi.fn(async () => {
          throw new Error("ClickHouse timed out");
        }),
      };

      await expect(
        run({ deps, source: { kind: "dashboard", dashboardId: "dash-1" } }),
      ).rejects.toThrow("ClickHouse timed out");
    });
  });

  describe("given a dashboard with more panels than the query concurrency cap", () => {
    it("bounds concurrent getTimeseries queries and still returns every chart in order", async () => {
      // Regression for the ADR-044 §5 finding: an unbounded Promise.all fanned
      // every panel's heavy ClickHouse query out at once. A large dashboard must
      // cap in-flight queries so a burst can't exhaust ClickHouse.
      const PANELS = REPORT_CHART_QUERY_CONCURRENCY * 3;
      const graphs = Array.from({ length: PANELS }, (_, i) =>
        makeGraph({ id: `graph-${i}`, name: `Panel ${i}` }),
      );

      let inFlight = 0;
      let maxInFlight = 0;
      const deps: ReportChartDeps = {
        findCustomGraph: vi.fn(async () => null),
        loadDashboardGraphs: vi.fn(async () => graphs),
        getTimeseries: vi.fn(async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          // Hold the slot briefly so overlapping queries actually coincide.
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
          return {
            previousPeriod: [],
            currentPeriod: [{ date: "2026-07-11T09:00:00Z", [COUNT_KEY]: 1 }],
          };
        }),
      };

      const charts = await run({
        deps,
        source: { kind: "dashboard", dashboardId: "dash-1" },
      });

      // Every panel is rendered, in dashboard order (the cap must not drop or
      // reorder panels).
      expect(charts).toHaveLength(PANELS);
      expect(charts.map((c) => c.title)).toEqual(graphs.map((g) => g.name));

      // Never more than the cap in flight, yet genuinely overlapped (not serial).
      expect(maxInFlight).toBeLessThanOrEqual(REPORT_CHART_QUERY_CONCURRENCY);
      expect(maxInFlight).toBeGreaterThan(1);
    });
  });

  describe("given a traceQuery report", () => {
    it("loads no charts at all", async () => {
      const deps = makeDeps({
        graphs: [makeGraph()],
        timeseries: { previousPeriod: [], currentPeriod: [] },
      });

      const charts = await run({
        deps,
        source: { kind: "traceQuery", filters: {}, topN: 5 },
      });

      expect(charts).toEqual([]);
      expect(deps.getTimeseries).not.toHaveBeenCalled();
    });
  });
});
