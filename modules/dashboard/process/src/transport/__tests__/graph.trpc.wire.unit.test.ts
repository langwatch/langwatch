/**
 * @vitest-environment node
 * The chart builder's `graphs.*` wire: the size a new graph lands at and the
 * sizes the eight-column grid may store. Spec: dashboard-service.feature.
 */
import {
  CHART_GRID_COLUMNS,
  CHART_GRID_DEFAULT_COL_SPAN,
  CHART_GRID_DEFAULT_ROW_SPAN,
} from "@langwatch/analytics-contract/chart-grid";
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import {
  graphApiBatchUpdateLayoutsInputSchema,
  graphApiCreateInputSchema,
  graphApiUpdateLayoutInputSchema,
  legacyGraphSchema,
  type DashboardApi,
} from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import { createDashboardTestApp } from "../../app/__tests__/dashboard.fixture.ts";
import { graphTrpcTransport } from "../graph.trpc.ts";

const PROJECT_ID = "project-1";

/** Mounted on a runtime that keeps each handler callable by its short name. */
function mounted(app: DashboardApi) {
  const callers = new Map<string, (input: unknown) => Promise<unknown>>();
  const runtime: TrpcProcedureFactory<object> = {
    procedure: (request) => {
      const name = request.procedure.split(".").at(-1) ?? request.procedure;
      callers.set(name, async (input) =>
        Reflect.apply(request.handle, undefined, [
          {
            app,
            input,
            actor: { id: "user_1" },
            scope: { tier: "project", id: PROJECT_ID },
            signal: undefined,
          },
        ]),
      );
      return {};
    },
    router: (record) => record,
  };

  graphTrpcTransport.router(runtime, () => app);

  return (name: string, input: unknown): Promise<unknown> => {
    const caller = callers.get(name);
    if (caller === undefined) throw new Error(`no procedure ${name}`);
    return caller(input);
  };
}

async function dashboardOn(app: DashboardApi) {
  return app.create({ projectId: PROJECT_ID, name: "Reports" });
}

const GRAPH = {
  projectId: PROJECT_ID,
  name: "Latency",
  graph: JSON.stringify({ graphType: "line" }),
};

describe("the graphs tRPC namespace", () => {
  describe("when the Custom Graph page creates a graph on a dashboard without a size", () => {
    /** @scenario "A graph created without a size lands at the grid's default size" */
    it("lands at half the grid's width and three rows", async () => {
      const app = createDashboardTestApp();
      const call = mounted(app);
      const dashboard = await dashboardOn(app);

      const created = legacyGraphSchema.parse(
        await call(
          "create",
          graphApiCreateInputSchema.parse({ ...GRAPH, dashboardId: dashboard.id }),
        ),
      );

      expect({ colSpan: created.colSpan, rowSpan: created.rowSpan }).toEqual({
        colSpan: CHART_GRID_DEFAULT_COL_SPAN,
        rowSpan: CHART_GRID_DEFAULT_ROW_SPAN,
      });
    });

    it("refuses a column the default width would run past the grid's edge from", () => {
      expect(
        graphApiCreateInputSchema.validate({ ...GRAPH, gridColumn: CHART_GRID_COLUMNS - 1 }),
      ).toBe(false);
    });
  });

  describe("when the grid resizes a graph to span all eight columns", () => {
    const WIDE = { gridColumn: 0, gridRow: 0, colSpan: CHART_GRID_COLUMNS, rowSpan: 6 };

    /** @scenario "A graph can be resized across the whole eight-column grid" */
    it("stores the new size and reads it back", async () => {
      const app = createDashboardTestApp();
      const call = mounted(app);
      const dashboard = await dashboardOn(app);
      const created = legacyGraphSchema.parse(
        await call("create", { ...GRAPH, dashboardId: dashboard.id }),
      );

      await call(
        "batchUpdateLayouts",
        graphApiBatchUpdateLayoutsInputSchema.parse({
          projectId: PROJECT_ID,
          layouts: [{ graphId: created.id, ...WIDE }],
        }),
      );

      await expect(
        call("getAll", { projectId: PROJECT_ID, dashboardId: dashboard.id }),
      ).resolves.toEqual([expect.objectContaining({ id: created.id, ...WIDE })]);
    });

    /** @scenario "A graph can be resized across the whole eight-column grid" */
    it("refuses a size that runs past the grid's right edge", () => {
      const pastTheEdge = { gridColumn: 6, gridRow: 0, colSpan: 4, rowSpan: 3 };

      expect(
        graphApiUpdateLayoutInputSchema.validate({
          projectId: PROJECT_ID,
          graphId: "graph_1",
          ...pastTheEdge,
        }),
      ).toBe(false);
      expect(
        graphApiBatchUpdateLayoutsInputSchema.validate({
          projectId: PROJECT_ID,
          layouts: [{ graphId: "graph_1", ...pastTheEdge }],
        }),
      ).toBe(false);
    });
  });
});
