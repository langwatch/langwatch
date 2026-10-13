import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
/**
 * @vitest-environment node
 * Keyed the way the process root keys namespaces (a dotted namespace nests,
 * see the suite wire test), so the paths asserted are main's wire.
 * Spec: lwql-saved-charts.feature.
 */
import type { DashboardApi } from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import { savedWorkbenchChartTrpcTransport } from "../saved-workbench-chart.trpc.ts";

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
});
