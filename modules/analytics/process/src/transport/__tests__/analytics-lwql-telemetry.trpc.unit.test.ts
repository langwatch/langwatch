/**
 * @vitest-environment node
 * The workbench door names a run's caller itself: a run that says which widget it is for is a
 * dashboard widget's, any other is the workbench's. The browser never names the caller.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */
import type {
  LangWatchQLExecuteInput,
  LangWatchQLProtections,
} from "@langwatch/analytics-contract";
import { createTrpcRuntime, TrpcRootDefinition } from "@langwatch/api/trpc";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { type AnalyticsLwqlApi, analyticsLwqlTrpcTransport } from "../analytics-lwql.trpc.ts";

type TestContext = { actor: { id: string } };

const PROJECT = { projectId: "project-1" };
const PROTECTIONS: LangWatchQLProtections = {
  catalogue: { permissions: [] },
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

/** The door over an app that keeps every run it is handed and answers each with no rows. */
function door() {
  const runs: LangWatchQLExecuteInput[] = [];
  const app = createApiFixture<AnalyticsLwqlApi>({
    isWorkbenchEnabled: async () => true,
    resolveRunCaller: async () => ({
      project: { id: "project-1", lwqlKey: "key-1" },
      protections: PROTECTIONS,
    }),
    executeLangWatchQL: async (input) => {
      runs.push(input);
      return {
        columns: [],
        rows: [],
        statistics: { elapsedMs: 0, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
        diagnostics: [],
        followsTimeWindow: false,
        followsGranularity: false,
      };
    },
  });
  const trpc = TrpcRootDefinition.forContext<TestContext>().create();
  const caller = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({ permits: () => true }),
  })
    .mount(analyticsLwqlTrpcTransport, () => app)
    .createCaller({ actor: { id: "member-1" } });
  return { caller, runs };
}

describe("given the analytics.lwql query procedure", () => {
  describe("when a run says which widget it is for", () => {
    /** @scenario "Telemetry: the caller is set by the server from the door the query came in by" */
    it("names the caller dashboard_widget and keeps the widget's ids", async () => {
      const { caller, runs } = door();

      await caller.query({
        ...PROJECT,
        sql: "SELECT 1",
        telemetry: { dashboardId: "dashboard-1", widgetId: "widget-1", templateId: "llm-cost" },
      });

      expect(runs[0]?.telemetry).toEqual({
        caller: "dashboard_widget",
        dashboardId: "dashboard-1",
        widgetId: "widget-1",
        templateId: "llm-cost",
      });
    });
  });

  describe("when a run names no widget", () => {
    /** @scenario "Telemetry: the caller is set by the server from the door the query came in by" */
    it("names the caller workbench", async () => {
      const { caller, runs } = door();

      await caller.query({ ...PROJECT, sql: "SELECT 1" });

      expect(runs[0]?.telemetry).toEqual({ caller: "workbench" });
    });
  });

  describe("when the browser tries to name the caller itself", () => {
    /** @scenario "Telemetry: the caller is set by the server from the door the query came in by" */
    it("refuses the request rather than record a caller it chose", async () => {
      const { caller, runs } = door();

      await expect(
        caller.query({
          ...PROJECT,
          sql: "SELECT 1",
          // @ts-expect-error: the request has no caller field, which is the point.
          telemetry: { widgetId: "widget-1", caller: "rest_api" },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(runs).toHaveLength(0);
    });
  });
});
