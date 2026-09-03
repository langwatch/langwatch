/**
 * @vitest-environment node
 *
 * What the saved-workbench-chart tRPC surface reaches for.
 *
 * The answers are all the application's, so this transport owns none of them.
 * What it does own is the thing every compatibility door used to decide for
 * itself: where the Dashboard capability comes from. Each procedure reads it
 * off the request's application context, so two procedures in one process
 * answer from one composed service rather than each building persistence of
 * its own.
 *
 * @see packages/features/dashboard/specs/dashboard-service.feature
 */
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { DashboardApp } from "../../../app/dashboard.app";
import {
  SavedWorkbenchChartTrpcApi,
  type SavedWorkbenchChartTrpcPorts,
} from "../saved-workbench-chart.api";

type TestContext = { app: { dashboard: DashboardApp } };

/**
 * Counts what it was reached through, so "one instance" is an observation
 * rather than an assumption: a transport that built its own would leave this
 * untouched.
 */
function recordingDashboard() {
  const reached: string[] = [];
  const app = {
    listSavedWorkbenchCharts: async () => {
      reached.push("listSavedWorkbenchCharts");
      return [];
    },
    getSavedWorkbenchChart: async () => {
      reached.push("getSavedWorkbenchChart");
      return { id: "chart-1" };
    },
    deleteSavedWorkbenchChart: async () => {
      reached.push("deleteSavedWorkbenchChart");
    },
  };
  return { reached, app: app as unknown as DashboardApp };
}

function harness() {
  const trpc = initTRPC.context<TestContext>().create();
  const declared: string[] = [];
  const ports: SavedWorkbenchChartTrpcPorts = {
    requireWorkbenchEnabled: <TProcedure>(procedure: TProcedure) => procedure,
    timeWindowSchema: z.any(),
    granularityStepSchema: z.number(),
    resolveProtections: async () => ({}),
    resolveRunCaller: async () => ({ project: {} as never, protections: {} }),
    admitDefinition: (_ctx, input) => input.definition,
    mapError: (error) => {
      throw error;
    },
  };

  const dashboard = recordingDashboard();
  const router = SavedWorkbenchChartTrpcApi.create(
    trpc,
    {
      protected: trpc.procedure,
      policy: (permission) => {
        declared.push(permission);
        return (procedure) => procedure;
      },
    },
    ports,
  );

  return {
    declared,
    reached: dashboard.reached,
    caller: router.createCaller({ app: { dashboard: dashboard.app } }),
  };
}

describe("SavedWorkbenchChartTrpcApi", () => {
  describe("given several procedures handled in one process", () => {
    /** @scenario "Compatibility transports share one service instance" */
    it("answers all of them from the application context's own Dashboard capability", async () => {
      const { caller, reached } = harness();

      await caller.getAll({ projectId: "project-1" });
      await caller.getById({ projectId: "project-1", id: "chart-1" });
      await caller.delete({ projectId: "project-1", id: "chart-1" });

      expect(reached).toEqual([
        "listSavedWorkbenchCharts",
        "getSavedWorkbenchChart",
        "deleteSavedWorkbenchChart",
      ]);
    });

    /** @scenario "Compatibility transports share one service instance" */
    it("declares the analytics permission on every one of them", async () => {
      const { declared } = harness();

      expect(declared).toEqual([
        "analytics:view",
        "analytics:view",
        "analytics:create",
        "analytics:update",
        "analytics:view",
        "analytics:delete",
      ]);
    });
  });
});
