/**
 * The server half of Dashboards v1, through the composed app over memory
 * repositories: every board reachable to every member, the rollout gate and
 * source presence. Spec: dashboards-v1.feature.
 */
import type { LangWatchQLExecuteInput } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import { createDashboardTestAnalytics, createDashboardTestApp } from "./dashboard.fixture.ts";

const PROJECT = "project-1";
const CREATOR = { userId: "creator" };
const TEAMMATE = { userId: "teammate" };
const OUTSIDER = { userId: "outsider" };

function appWith(
  options: Readonly<{
    dashboardsEnabled?: boolean;
    repositories?: ReturnType<typeof MemoryDashboardRepositories.create>;
    executeLangWatchQL?: (
      input: LangWatchQLExecuteInput,
    ) => Promise<{ rows: Record<string, unknown>[] }>;
  }> = {},
) {
  return createDashboardTestApp({
    ...(options.repositories === undefined ? {} : { repositories: options.repositories }),
    dependencies: {
      analytics: createDashboardTestAnalytics({
        isDashboardsEnabled: async () => options.dashboardsEnabled ?? true,
        ...(options.executeLangWatchQL === undefined
          ? {}
          : {
              executeLangWatchQL: async (input) => ({
                columns: [],
                rows: (await options.executeLangWatchQL?.(input))?.rows ?? [],
                statistics: { elapsedMs: 0, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
                diagnostics: [],
                followsTimeWindow: false,
                followsGranularity: false,
              }),
            }),
      }),
    },
  });
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

describe("Dashboards v1 on the server", () => {
  describe("given boards created by different members", () => {
    /** @scenario "AC18 Every board in the project is visible to every member" */
    it("lists and opens every board for every member", async () => {
      const app = appWith();
      const mine = await app.create({
        projectId: PROJECT,
        name: "Mine",
        createdById: CREATOR.userId,
      });
      const theirs = await app.create({
        projectId: PROJECT,
        name: "Theirs",
        createdById: TEAMMATE.userId,
      });

      const listedFor = async (viewer: { userId: string }) =>
        (await app.getAll({ projectId: PROJECT, graphCountScope: "builder", viewer })).map(
          (board) => board.id,
        );

      expect(await listedFor(CREATOR)).toEqual([mine.id, theirs.id]);
      expect(await listedFor(OUTSIDER)).toEqual([mine.id, theirs.id]);
      await expect(
        app.getById({ projectId: PROJECT, dashboardId: theirs.id, viewer: OUTSIDER }),
      ).resolves.toMatchObject({ id: theirs.id });
    });

    /** @scenario "AC26 Any member with the edit permission can edit any board" */
    it("lets any member rename, describe and delete a board another member created", async () => {
      const app = appWith();
      const board = await app.create({
        projectId: PROJECT,
        name: "Mine",
        createdById: CREATOR.userId,
      });

      await expect(
        app.updateDashboardDetails({
          projectId: PROJECT,
          dashboardId: board.id,
          viewer: TEAMMATE,
          name: "Ours",
          description: "Shared numbers",
        }),
      ).resolves.toMatchObject({ name: "Ours", description: "Shared numbers" });
      await expect(
        app.delete({ projectId: PROJECT, dashboardId: board.id, viewer: OUTSIDER }),
      ).resolves.toMatchObject({ id: board.id });
    });
  });

  describe("given blocks and a saved chart on a board", () => {
    const WIDGET = {
      projectId: PROJECT,
      name: "Usage",
      code: "export default () => null;",
      queries: [{ name: "usage", sql: "SELECT 1" }],
    };

    async function boardWithBlocks() {
      const repositories = MemoryDashboardRepositories.create();
      const app = appWith({ repositories });
      const board = await app.create({
        projectId: PROJECT,
        name: "Reports",
        createdById: CREATOR.userId,
      });
      const placed = await app.createDashboardWidget({
        ...WIDGET,
        dashboardId: board.id,
        viewer: CREATOR,
      });
      const unplaced = await app.createDashboardWidget({ ...WIDGET, viewer: TEAMMATE });
      await repositories.dashboards.createSavedWorkbenchChart({
        id: "chart-placed",
        projectId: PROJECT,
        name: "Spend",
        definition: { version: 1, sql: "SELECT 1", parameters: {} },
      });
      await app.placeSavedWorkbenchChart({
        projectId: PROJECT,
        chartId: "chart-placed",
        dashboardId: board.id,
        viewer: CREATOR,
      });
      return { app, repositories, board, placed, unplaced };
    }

    /** @scenario "AC18 Blocks on any board are reachable to every member" */
    it("lists, reads and writes every block for every member", async () => {
      const { app, board, placed, unplaced } = await boardWithBlocks();
      const listedFor = async (viewer?: { userId: string }) =>
        (await app.listDashboardWidgets({ projectId: PROJECT, viewer })).map(({ id }) => id);

      expect(await listedFor(TEAMMATE)).toEqual(expect.arrayContaining([placed.id, unplaced.id]));
      expect(await listedFor(undefined)).toEqual(expect.arrayContaining([placed.id, unplaced.id]));

      await expect(
        app.getDashboardWidget({ projectId: PROJECT, id: placed.id, viewer: OUTSIDER }),
      ).resolves.toMatchObject({ id: placed.id });
      await expect(
        app.createDashboardWidget({ ...WIDGET, dashboardId: board.id, viewer: OUTSIDER }),
      ).resolves.toMatchObject({ dashboardId: board.id });
      await expect(
        app.deleteDashboardWidget({ projectId: PROJECT, id: placed.id, viewer: TEAMMATE }),
      ).resolves.toBeUndefined();
    });

    /** @scenario "AC18 Saved charts on any board are reachable to every member" */
    it("lists and reads the placed chart for every member and a project credential", async () => {
      const { app } = await boardWithBlocks();
      const listedFor = async (viewer?: { userId: string }) =>
        (await app.listSavedWorkbenchCharts({ projectId: PROJECT, viewer })).map(({ id }) => id);

      expect(await listedFor(TEAMMATE)).toEqual(["chart-placed"]);
      expect(await listedFor(undefined)).toEqual(["chart-placed"]);
      await expect(
        app.getSavedWorkbenchChart({
          projectId: PROJECT,
          chartId: "chart-placed",
          viewer: OUTSIDER,
        }),
      ).resolves.toMatchObject({ name: "Spend" });
    });
  });

  describe("given a board created before the description and creator fields existed", () => {
    /** @scenario "AC24 Boards created before this change keep working" */
    it("stays listed, openable and deletable for any member", async () => {
      const repositories = MemoryDashboardRepositories.create();
      const legacy = await repositories.dashboards.createDashboard({
        id: "legacy-board",
        projectId: PROJECT,
        name: "Reports",
        order: 0,
      });
      const app = appWith({ repositories });

      await expect(
        app.getAll({ projectId: PROJECT, graphCountScope: "builder", viewer: OUTSIDER }),
      ).resolves.toMatchObject([{ id: legacy.id }]);
      await expect(
        app.getById({ projectId: PROJECT, dashboardId: legacy.id, viewer: OUTSIDER }),
      ).resolves.toMatchObject({ id: legacy.id });
      await expect(
        app.delete({ projectId: PROJECT, dashboardId: legacy.id, viewer: OUTSIDER }),
      ).resolves.toMatchObject({ id: legacy.id });
    });
  });

  describe("given a member's board", () => {
    /** @scenario "AC14 Rename and describe" */
    it("saves a new name and description, and lists the new name", async () => {
      const app = appWith();
      const board = await app.create({
        projectId: PROJECT,
        name: "Mine",
        createdById: CREATOR.userId,
      });

      await app.updateDashboardDetails({
        projectId: PROJECT,
        dashboardId: board.id,
        viewer: CREATOR,
        name: "Latency watch",
        description: "p95 by model",
      });

      await expect(
        app.getAll({ projectId: PROJECT, graphCountScope: "builder", viewer: CREATOR }),
      ).resolves.toMatchObject([
        { id: board.id, name: "Latency watch", description: "p95 by model" },
      ]);
    });
  });

  describe("when release_dashboards is off for the project", () => {
    /** @scenario "AC21 A refused member sees the same not-found page" */
    it("answers every Dashboards-area procedure with dashboards_not_enabled", async () => {
      const repositories = MemoryDashboardRepositories.create();
      const seeded = appWith({ repositories });
      const board = await seeded.create({
        projectId: PROJECT,
        name: "Reports",
        createdById: CREATOR.userId,
      });
      const app = appWith({ repositories, dashboardsEnabled: false });
      const ref = { projectId: PROJECT, dashboardId: board.id, viewer: CREATOR };

      const codes = await Promise.all([
        codeOf(app.updateDashboardDetails({ ...ref, name: "Off" })),
        codeOf(app.getSourcePresence({ projectId: PROJECT, viewer: CREATOR })),
      ]);

      expect(codes).toEqual(Array(codes.length).fill("dashboards_not_enabled"));
    });

    it("leaves the procedures legacy analytics reads untouched", async () => {
      const app = appWith({ dashboardsEnabled: false });

      await expect(
        app.getOrCreateFirst({ projectId: PROJECT, viewer: CREATOR }),
      ).resolves.toMatchObject({ name: "Reports", createdById: CREATOR.userId });
    });
  });

  describe("given a project that recorded traces and scenarios, but whose gateway query fails", () => {
    /** @scenario "AC7 Connected state comes from real data" */
    it("answers present, absent or failed per source from the rows each query returns", async () => {
      const recorded = ["trace_metrics", "simulations"];
      const app = appWith({
        executeLangWatchQL: async ({ sql }) => {
          if (sql.includes("gateway_request_spend")) throw new Error("view unavailable");
          return { rows: recorded.some((table) => sql.includes(table)) ? [{ present: 1 }] : [] };
        },
      });

      await expect(app.getSourcePresence({ projectId: PROJECT, viewer: CREATOR })).resolves.toEqual(
        {
          traces: "present",
          scenarios: "present",
          judges: "absent",
          feedback: "absent",
          gateway: "failed",
          codingAgents: "absent",
        },
      );
    });
  });
});
