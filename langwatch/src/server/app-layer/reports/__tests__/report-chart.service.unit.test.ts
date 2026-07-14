import type { CustomGraph } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { TimeseriesResult } from "~/server/analytics/types";
import { buildSeriesName } from "~/server/app-layer/analytics/repositories/_timeseries-row-parser";
import type { ReportSource } from "~/server/app-layer/triggers/report.builder";
import {
  loadReportCharts,
  REPORT_CHART_QUERY_CONCURRENCY,
  type ReportChartDeps,
} from "../report-chart.service";

const COUNT_SERIES = {
  metric: "metadata.trace_id",
  aggregation: "cardinality",
  name: "Traces",
};
/** The bucket key the timeseries result really uses — NOT the display name. */
const COUNT_KEY = buildSeriesName(COUNT_SERIES as never, 0);

function makeGraph(overrides: Partial<CustomGraph> = {}): CustomGraph {
  return {
    id: "graph-1",
    name: "Traces per hour",
    projectId: "proj-1",
    filters: {},
    graph: {
      graphId: "graph-1",
      graphType: "line",
      series: [COUNT_SERIES],
      includePrevious: false,
      timeScale: 60,
    },
    ...overrides,
  } as unknown as CustomGraph;
}

function makeDeps({
  graphs,
  timeseries,
}: {
  graphs: CustomGraph[];
  timeseries: TimeseriesResult;
}): ReportChartDeps {
  return {
    loadCustomGraph: vi.fn(async () => graphs[0] ?? null),
    loadDashboardGraphs: vi.fn(async () => graphs),
    getTimeseries: vi.fn(async () => timeseries),
  };
}

const WINDOW = { from: 0, to: 3_600_000 };

function run({
  deps,
  source,
}: {
  deps: ReportChartDeps;
  source: ReportSource;
}) {
  return loadReportCharts({ deps, source, projectId: "proj-1", ...WINDOW });
}

describe("loadReportCharts", () => {
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
          } as unknown as Partial<CustomGraph>),
        ],
        timeseries: {
          previousPeriod: [],
          currentPeriod: [
            {
              date: "2026-07-11T09:00:00Z",
              "metadata.model": {
                "gpt-5-mini": { [COUNT_KEY]: 2 },
                "claude-opus-4-8": { [COUNT_KEY]: 5 },
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
        loadCustomGraph: vi.fn(async () => null),
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
