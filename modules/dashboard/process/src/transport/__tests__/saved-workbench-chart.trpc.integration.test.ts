/**
 * @vitest-environment node
 * The saved workbench chart tRPC family on the real runtime over the real
 * dashboard application and memory repositories. Only the authorization
 * answer, the workbench switch and the query engine are the test's.
 * @see specs/lwql/workbench.feature
 * @see specs/lwql/saved-charts.feature
 */
import type {
  LangWatchQLExecuteInput,
  LangWatchQLQueryResult,
} from "@langwatch/analytics-contract";
import { createTrpcRuntime, TrpcRootDefinition } from "@langwatch/api/trpc";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it, vi } from "vitest";

import {
  createDashboardTestAnalytics,
  createDashboardTestApp,
  FULLY_PERMITTED,
} from "../../app/__tests__/dashboard.fixture.ts";
import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import { savedWorkbenchChartTrpcTransport } from "../saved-workbench-chart.trpc.ts";

type TestContext = { actor: { id: string } };

const STORED_KEY = "key-the-database-holds";
const DEFINITION = {
  version: 1 as const,
  sql: "SELECT count() AS value FROM analytics.traces",
  parameters: {},
};
const EMPTY_RESULT: LangWatchQLQueryResult = {
  columns: [],
  rows: [],
  statistics: { elapsedMs: 0, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
  diagnostics: [],
  followsTimeWindow: false,
  followsGranularity: false,
};

function membersHolding(held: readonly string[]) {
  return trpcTestMembers<TestContext>({ permits: (permission) => held.includes(permission) });
}

async function member({ held, enabled = true }: { held: readonly string[]; enabled?: boolean }) {
  const executed: LangWatchQLExecuteInput[] = [];
  const resolveRunCaller = vi.fn(async ({ projectId }: { userId: string; projectId: string }) => ({
    project: { id: projectId, lwqlKey: STORED_KEY },
    protections: FULLY_PERMITTED,
  }));
  const repositories = MemoryDashboardRepositories.create();
  await repositories.dashboards.createSavedWorkbenchChart({
    id: "chart-1",
    projectId: "project-1",
    name: "Traces",
    definition: DEFINITION,
  });
  const app = createDashboardTestApp({
    repositories,
    dependencies: {
      analytics: createDashboardTestAnalytics({
        isWorkbenchEnabled: async () => enabled,
        resolveRunCaller,
        executeLangWatchQL: async (input) => {
          executed.push(input);

          return EMPTY_RESULT;
        },
      }),
    },
  });
  const trpc = TrpcRootDefinition.forContext<TestContext>().create();
  const caller = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: membersHolding(held),
  })
    .mount(savedWorkbenchChartTrpcTransport, () => app)
    .createCaller({ actor: { id: "member-1" } });

  return { caller, executed, resolveRunCaller };
}

describe("given the saved workbench chart tRPC family", () => {
  describe("when the workbench switch is off", () => {
    /** @scenario "Running a saved chart carries the same permission and switch as every other chart procedure" */
    it("refuses the run with lwql_not_enabled and executes nothing", async () => {
      const { caller, executed } = await member({ held: ["analytics:view"], enabled: false });

      await expect(caller.run({ projectId: "project-1", id: "chart-1" })).rejects.toMatchObject({
        cause: { code: "lwql_not_enabled" },
      });
      expect(executed).toEqual([]);
    });
  });

  describe("when the workbench switch is off and a permitted member reads charts", () => {
    /** @scenario "A saved chart stays unreachable while the workbench switch is off" */
    it("refuses opening a chart and listing charts with lwql_not_enabled", async () => {
      const { caller } = await member({ held: ["analytics:view"], enabled: false });

      await expect(caller.getById({ projectId: "project-1", id: "chart-1" })).rejects.toMatchObject(
        { cause: { code: "lwql_not_enabled" } },
      );
      await expect(caller.getAll({ projectId: "project-1" })).rejects.toMatchObject({
        cause: { code: "lwql_not_enabled" },
      });
    });
  });

  describe("when the switch is on and the member lacks the analytics view permission", () => {
    /** @scenario "Running a saved chart carries the same permission and switch as every other chart procedure" */
    /** @scenario "A run is refused for a member without the analytics view permission, and nothing is executed" */
    it("refuses the run as forbidden and never consults the query engine", async () => {
      const { caller, executed, resolveRunCaller } = await member({ held: [] });

      await expect(caller.run({ projectId: "project-1", id: "chart-1" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(resolveRunCaller).not.toHaveBeenCalled();
      expect(executed).toEqual([]);
    });
  });

  describe("when the member may view analytics and manage no chart", () => {
    /** @scenario "Being allowed to read a chart is being allowed to run one" */
    it("runs the chart", async () => {
      const { caller, executed } = await member({ held: ["analytics:view"] });

      await expect(caller.run({ projectId: "project-1", id: "chart-1" })).resolves.toMatchObject({
        followsGranularity: false,
      });
      expect(executed).toHaveLength(1);
      expect(executed[0]?.sql).toBe(DEFINITION.sql);
    });
  });

  describe("when a run is executed for the project in the request", () => {
    /** @scenario "A run names the tenant the database holds for the project in the request" */
    it("carries the stored key for that project to the engine", async () => {
      const { caller, executed, resolveRunCaller } = await member({ held: ["analytics:view"] });

      await caller.run({ projectId: "project-1", id: "chart-1" });

      expect(resolveRunCaller).toHaveBeenCalledWith({
        userId: "member-1",
        projectId: "project-1",
      });
      expect(executed[0]?.project).toEqual({ id: "project-1", lwqlKey: STORED_KEY });
    });
  });

  describe("when a member without the analytics view permission opens a chart", () => {
    /** @scenario "Reading a saved chart requires the analytics permission" */
    it("refuses the read as forbidden", async () => {
      const { caller } = await member({ held: [] });

      await expect(caller.getById({ projectId: "project-1", id: "chart-1" })).rejects.toMatchObject(
        { code: "FORBIDDEN" },
      );
    });
  });

  describe("when a chart saved in another project is opened by its id", () => {
    /** @scenario "Every procedure answers only for the project in the request" */
    it("answers exactly as it does for an id that never existed", async () => {
      const { caller } = await member({ held: ["analytics:view"] });

      const foreign = await caller
        .getById({ projectId: "project-2", id: "chart-1" })
        .catch((error: unknown) => error);
      const unknown = await caller
        .getById({ projectId: "project-2", id: "chart-that-never-existed" })
        .catch((error: unknown) => error);

      expect(foreign).toMatchObject({ cause: { code: "saved_workbench_chart_not_found" } });
      expect(unknown).toMatchObject({ cause: { code: "saved_workbench_chart_not_found" } });
    });
  });
});
