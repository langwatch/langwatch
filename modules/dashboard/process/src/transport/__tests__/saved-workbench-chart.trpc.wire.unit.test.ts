import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
/**
 * @vitest-environment node
 * Keyed the way the process root keys namespaces (a dotted namespace nests,
 * see the suite wire test), so the paths asserted are main's wire.
 * Spec: lwql-saved-charts.feature.
 */
import type { DashboardApi } from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import { createDashboardTestApp } from "../../app/__tests__/dashboard.fixture.ts";
import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import { savedWorkbenchChartTrpcTransport } from "../saved-workbench-chart.trpc.ts";

const PROJECT_ID = "project-1";

function composedPaths(): string[] {
  const names: string[] = [];
  const runtime: TrpcProcedureFactory<object> = {
    procedure: () => ({}),
    router: (record) => {
      names.push(...Object.keys(record));
      return record;
    },
  };
  const app = (): DashboardApi => {
    throw new Error("This test composes but never handles a request");
  };

  savedWorkbenchChartTrpcTransport.router(runtime, app);

  return names.map((name) => `${savedWorkbenchChartTrpcTransport.namespace}.${name}`).toSorted();
}

/** Each procedure's handler, called as the signed-in member `actorId`. */
function callerAs(app: DashboardApi, actorId: string) {
  const handlers = new Map<string, (args: object) => Promise<unknown>>();
  const runtime: TrpcProcedureFactory<object> = {
    procedure: (request) => {
      const name = request.procedure.split(".").at(-1) ?? request.procedure;
      handlers.set(name, async (args) => Reflect.apply(request.handle, undefined, [args]));
      return {};
    },
    router: (record) => record,
  };
  savedWorkbenchChartTrpcTransport.router(runtime, () => app);

  return async (name: string, input: object): Promise<unknown> => {
    const handler = handlers.get(name);
    if (handler === undefined) throw new Error(`no procedure ${name}`);
    return handler({ app, input, actor: { id: actorId }, scope: {}, signal: undefined });
  };
}

/** The `code` a rejected call carries, or why there is none. */
async function codeOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  return "<resolved>";
}

describe("the saved workbench chart tRPC namespace", () => {
  describe("when the process root composes it", () => {
    it("serves every procedure under analytics.savedWorkbenchCharts, as main did", () => {
      expect(composedPaths()).toEqual([
        "analytics.savedWorkbenchCharts.create",
        "analytics.savedWorkbenchCharts.delete",
        "analytics.savedWorkbenchCharts.getAll",
        "analytics.savedWorkbenchCharts.getById",
        "analytics.savedWorkbenchCharts.run",
        "analytics.savedWorkbenchCharts.update",
      ]);
    });
  });

  describe("given a chart placed on another member's only-me board", () => {
    /** @scenario "AC18 Saved charts on a board follow the board's visibility" */
    it("leaves it out of the signed-in member's list and refuses it as not found", async () => {
      const repositories = MemoryDashboardRepositories.create();
      const app = createDashboardTestApp({ repositories });
      const creator = { userId: "creator" };
      const board = await app.create({
        projectId: PROJECT_ID,
        name: "Mine",
        createdById: "creator",
      });
      await app.setDashboardVisibility({
        projectId: PROJECT_ID,
        dashboardId: board.id,
        viewer: creator,
        visibility: "only_me",
      });
      await repositories.dashboards.createSavedWorkbenchChart({
        id: "chart-placed",
        projectId: PROJECT_ID,
        name: "Spend",
        definition: { version: 1, sql: "SELECT 1", parameters: {} },
      });
      await app.placeSavedWorkbenchChart({
        projectId: PROJECT_ID,
        chartId: "chart-placed",
        dashboardId: board.id,
        viewer: creator,
      });
      const call = callerAs(app, "teammate");
      const chart = { projectId: PROJECT_ID, id: "chart-placed" };

      await expect(call("getAll", { projectId: PROJECT_ID })).resolves.toEqual([]);
      const codes = await Promise.all([
        codeOf(call("getById", chart)),
        codeOf(call("update", { ...chart, name: "Taken" })),
        codeOf(call("run", chart)),
        codeOf(call("delete", chart)),
      ]);
      expect(codes).toEqual(Array(codes.length).fill("saved_workbench_chart_not_found"));
      await expect(callerAs(app, "creator")("getById", chart)).resolves.toMatchObject({
        name: "Spend",
      });
    });
  });
});
