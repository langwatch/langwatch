/**
 * The server half of Dashboards v1, through the composed app over memory
 * repositories: the read-only Flight Deck, visibility, who may manage a
 * board, the rollout gate and source presence. Spec: dashboards-v1.feature.
 */
import type { LangWatchQLExecuteInput } from "@langwatch/analytics-contract";
import { FLIGHT_DECK_DASHBOARD_ID } from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import {
  createDashboardTestAnalytics,
  createDashboardTestApp,
  createDashboardTestAuthz,
  createDashboardTestFeatureFlags,
  createDashboardTestOrganizations,
} from "./dashboard.fixture.ts";

const PROJECT = "project-1";
const CREATOR = { userId: "creator" };
const TEAMMATE = { userId: "teammate" };
const OUTSIDER = { userId: "outsider" };
/** A project admin, and like any project admin a member of the project's team. */
const ADMIN = { userId: "admin" };

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
      featureFlags: createDashboardTestFeatureFlags(options.dashboardsEnabled ?? true),
      authz: createDashboardTestAuthz([ADMIN.userId]),
      organizations: createDashboardTestOrganizations([
        CREATOR.userId,
        TEAMMATE.userId,
        ADMIN.userId,
      ]),
      ...(options.executeLangWatchQL === undefined
        ? {}
        : {
            analytics: createDashboardTestAnalytics({
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

async function boardSetTo(
  visibility: "only_me" | "team" | "organisation",
  app = appWith(),
): Promise<{ app: ReturnType<typeof appWith>; id: string }> {
  const created = await app.create({ projectId: PROJECT, name: "Mine", createdById: "creator" });
  await app.setDashboardVisibility({
    projectId: PROJECT,
    dashboardId: created.id,
    viewer: CREATOR,
    visibility,
  });
  return { app, id: created.id };
}

describe("Dashboards v1 on the server", () => {
  describe("given the Flight Deck, which is defined in code and has no row", () => {
    /** @scenario "AC8 The server rejects a write against the Flight Deck" */
    it("refuses every dashboard and chart write aimed at it with dashboard_read_only", async () => {
      const app = appWith();
      const deck = { projectId: PROJECT, dashboardId: FLIGHT_DECK_DASHBOARD_ID, viewer: ADMIN };
      const layout = { gridColumn: 0, gridRow: 0, colSpan: 1, rowSpan: 1 };

      const codes = await Promise.all([
        codeOf(app.rename({ ...deck, name: "Renamed" })),
        codeOf(app.updateDashboardDetails({ ...deck, description: "Mine now" })),
        codeOf(app.setDashboardVisibility({ ...deck, visibility: "only_me" })),
        codeOf(app.delete(deck)),
        codeOf(app.reorder({ projectId: PROJECT, dashboardIds: [FLIGHT_DECK_DASHBOARD_ID] })),
        codeOf(
          app.createGraph({
            projectId: PROJECT,
            name: "Added",
            graph: {},
            dashboardId: FLIGHT_DECK_DASHBOARD_ID,
            layout,
          }),
        ),
        codeOf(
          app.createDashboardWidget({
            projectId: PROJECT,
            dashboardId: FLIGHT_DECK_DASHBOARD_ID,
            name: "Widget",
            code: "export default () => null;",
            queries: [{ name: "q", sql: "SELECT 1" }],
          }),
        ),
        codeOf(
          app.assignDashboardWidgetToDashboard({
            projectId: PROJECT,
            id: "widget-1",
            dashboardId: FLIGHT_DECK_DASHBOARD_ID,
          }),
        ),
        codeOf(
          app.placeSavedWorkbenchChart({
            projectId: PROJECT,
            chartId: "chart-1",
            dashboardId: FLIGHT_DECK_DASHBOARD_ID,
          }),
        ),
      ]);

      expect(codes).toEqual(Array(codes.length).fill("dashboard_read_only"));
    });
  });

  describe("given boards set to only me, team and organisation by their creator", () => {
    /** @scenario "AC18 Visibility hides a board from members outside its audience" */
    it("lists and opens each board only for members inside its audience", async () => {
      const app = appWith();
      const onlyMe = (await boardSetTo("only_me", app)).id;
      const team = (await boardSetTo("team", app)).id;
      const organisation = (await boardSetTo("organisation", app)).id;

      const listedFor = async (viewer: { userId: string }) =>
        (await app.getAll({ projectId: PROJECT, graphCountScope: "builder", viewer })).map(
          (board) => board.id,
        );

      expect(await listedFor(CREATOR)).toEqual([onlyMe, team, organisation]);
      expect(await listedFor(TEAMMATE)).toEqual([team, organisation]);
      expect(await listedFor(OUTSIDER)).toEqual([organisation]);

      expect(
        await codeOf(app.getById({ projectId: PROJECT, dashboardId: onlyMe, viewer: TEAMMATE })),
      ).toBe("dashboard_not_found");
      expect(
        await codeOf(app.getById({ projectId: PROJECT, dashboardId: team, viewer: OUTSIDER })),
      ).toBe("dashboard_not_found");
      await expect(
        app.getById({ projectId: PROJECT, dashboardId: team, viewer: TEAMMATE }),
      ).resolves.toMatchObject({ id: team });
    });

    /** @scenario "AC26 The server refuses every write from a member outside the audience" */
    it("refuses every write from a member outside the audience as not found", async () => {
      const { app, id } = await boardSetTo("team");
      const outside = { projectId: PROJECT, dashboardId: id, viewer: OUTSIDER };

      const codes = await Promise.all([
        codeOf(app.rename({ ...outside, name: "Taken" })),
        codeOf(app.updateDashboardDetails({ ...outside, description: "Taken" })),
        codeOf(app.setDashboardVisibility({ ...outside, visibility: "organisation" })),
        codeOf(app.delete(outside)),
        codeOf(
          app.createGraph({
            projectId: PROJECT,
            name: "Added",
            graph: {},
            dashboardId: id,
            viewer: OUTSIDER,
          }),
        ),
      ]);

      expect(codes).toEqual(Array(codes.length).fill("dashboard_not_found"));
    });

    /** @scenario "AC26 A member inside the audience with the edit permission can edit" */
    it("lets a member inside the audience rename and describe it", async () => {
      const { app, id } = await boardSetTo("team");

      await expect(
        app.updateDashboardDetails({
          projectId: PROJECT,
          dashboardId: id,
          viewer: TEAMMATE,
          name: "Ours",
          description: "Shared numbers",
        }),
      ).resolves.toMatchObject({ name: "Ours", description: "Shared numbers" });
    });

    /** @scenario "AC26 Only the creator or an admin can change visibility or delete the board" */
    it("refuses a visibility change or delete from anyone but the creator or an admin", async () => {
      const { app, id } = await boardSetTo("team");
      const board = { projectId: PROJECT, dashboardId: id };

      expect(
        await codeOf(
          app.setDashboardVisibility({ ...board, viewer: TEAMMATE, visibility: "organisation" }),
        ),
      ).toBe("dashboard_owner_only");
      expect(await codeOf(app.delete({ ...board, viewer: TEAMMATE }))).toBe("dashboard_owner_only");

      await expect(
        app.setDashboardVisibility({ ...board, viewer: ADMIN, visibility: "organisation" }),
      ).resolves.toMatchObject({ visibility: "organisation" });
      await expect(app.delete({ ...board, viewer: CREATOR })).resolves.toMatchObject({ id });
    });
  });

  describe("given blocks on a board set to only me by its creator", () => {
    const WIDGET = {
      projectId: PROJECT,
      name: "Usage",
      code: "export default () => null;",
      queries: [{ name: "usage", sql: "SELECT 1" }],
    };
    const LAYOUT = { gridColumn: 3, gridRow: 7, colSpan: 2, rowSpan: 2 };

    async function privateBoardWithBlocks() {
      const repositories = MemoryDashboardRepositories.create();
      const { app, id } = await boardSetTo("only_me", appWith({ repositories }));
      const placed = await app.createDashboardWidget({
        ...WIDGET,
        dashboardId: id,
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
        dashboardId: id,
        viewer: CREATOR,
      });
      return { app, repositories, id, placed, unplaced };
    }

    /** @scenario "AC18 Blocks on a board follow the board's visibility" */
    it("lists its blocks only for members who can see the board", async () => {
      const { app, placed, unplaced } = await privateBoardWithBlocks();
      const listedFor = async (viewer?: { userId: string }) =>
        (await app.listDashboardWidgets({ projectId: PROJECT, viewer })).map(({ id }) => id);

      expect(await listedFor(CREATOR)).toEqual(expect.arrayContaining([placed.id, unplaced.id]));
      expect(await listedFor(TEAMMATE)).toEqual([unplaced.id]);
      expect(await listedFor(undefined)).toEqual([unplaced.id]);
    });

    /** @scenario "AC18 Blocks on a board follow the board's visibility" */
    it("refuses every block read and write from another member as not found", async () => {
      const { app, id, placed, unplaced } = await privateBoardWithBlocks();
      const onBoard = { projectId: PROJECT, id: placed.id, viewer: TEAMMATE };

      const widgetCodes = await Promise.all([
        codeOf(app.getDashboardWidget(onBoard)),
        codeOf(app.updateDashboardWidget({ ...onBoard, name: "Taken" })),
        codeOf(app.deleteDashboardWidget(onBoard)),
        codeOf(app.createDashboardWidget({ ...WIDGET, dashboardId: id, viewer: TEAMMATE })),
        codeOf(
          app.assignDashboardWidgetToDashboard({
            projectId: PROJECT,
            id: unplaced.id,
            dashboardId: id,
            viewer: TEAMMATE,
          }),
        ),
      ]);
      expect(widgetCodes).toEqual(Array(widgetCodes.length).fill("dashboard_widget_not_found"));

      expect(
        await codeOf(
          app.unplaceSavedWorkbenchChart({
            projectId: PROJECT,
            chartId: "chart-placed",
            viewer: TEAMMATE,
          }),
        ),
      ).toBe("saved_workbench_chart_not_found");
      expect(
        await codeOf(
          app.placeSavedWorkbenchChart({
            projectId: PROJECT,
            chartId: "chart-placed",
            dashboardId: id,
            viewer: TEAMMATE,
          }),
        ),
      ).toBe("saved_workbench_chart_dashboard_not_found");
    });

    /** @scenario "AC18 Blocks on a board follow the board's visibility" */
    it("leaves a block where it was when another member moves it", async () => {
      const { app, placed } = await privateBoardWithBlocks();

      await app.updateDashboardWidgetLayout({
        projectId: PROJECT,
        graphId: placed.id,
        layout: LAYOUT,
        viewer: TEAMMATE,
      });
      await app.batchUpdateDashboardWidgetLayouts({
        projectId: PROJECT,
        layouts: [{ graphId: placed.id, layout: LAYOUT }],
      });

      await expect(
        app.getDashboardWidget({ projectId: PROJECT, id: placed.id, viewer: CREATOR }),
      ).resolves.toMatchObject({ gridColumn: placed.gridColumn, gridRow: placed.gridRow });
    });

    /** @scenario "AC18 Blocks on a board follow the board's visibility" */
    it("lets the creator move and delete the blocks on their own board", async () => {
      const { app, placed } = await privateBoardWithBlocks();

      await app.updateDashboardWidgetLayout({
        projectId: PROJECT,
        graphId: placed.id,
        layout: LAYOUT,
        viewer: CREATOR,
      });
      await expect(
        app.getDashboardWidget({ projectId: PROJECT, id: placed.id, viewer: CREATOR }),
      ).resolves.toMatchObject(LAYOUT);
      await expect(
        app.deleteDashboardWidget({ projectId: PROJECT, id: placed.id, viewer: CREATOR }),
      ).resolves.toBeUndefined();
    });

    /** @scenario "AC18 Saved charts on a board follow the board's visibility" */
    it("leaves its saved charts out of another member's list and refuses them as not found", async () => {
      const { app, repositories } = await privateBoardWithBlocks();
      await repositories.dashboards.createSavedWorkbenchChart({
        id: "chart-loose",
        projectId: PROJECT,
        name: "Loose",
        definition: { version: 1, sql: "SELECT 1", parameters: {} },
      });
      const onBoard = { projectId: PROJECT, chartId: "chart-placed", viewer: TEAMMATE };
      const listedFor = async (viewer?: { userId: string }) =>
        (await app.listSavedWorkbenchCharts({ projectId: PROJECT, viewer })).map(({ id }) => id);

      expect(await listedFor(TEAMMATE)).toEqual(["chart-loose"]);
      expect(await listedFor(undefined)).toEqual(["chart-loose"]);
      expect(await listedFor(CREATOR)).toEqual(
        expect.arrayContaining(["chart-placed", "chart-loose"]),
      );

      const codes = await Promise.all([
        codeOf(app.getSavedWorkbenchChart(onBoard)),
        codeOf(app.getSavedWorkbenchChart({ projectId: PROJECT, chartId: "chart-placed" })),
        codeOf(app.updateSavedWorkbenchChart({ ...onBoard, name: "Taken" })),
        codeOf(
          app.updateMemberSavedWorkbenchChart({
            ...onBoard,
            actorId: TEAMMATE.userId,
            name: "Taken",
          }),
        ),
        codeOf(app.runSavedWorkbenchChart({ ...onBoard, actorId: TEAMMATE.userId })),
        codeOf(app.deleteSavedWorkbenchChart(onBoard)),
      ]);
      expect(codes).toEqual(Array(codes.length).fill("saved_workbench_chart_not_found"));

      await expect(
        app.getSavedWorkbenchChart({ ...onBoard, viewer: CREATOR }),
      ).resolves.toMatchObject({ name: "Spend" });
    });

    /** @scenario "AC18 Saved charts on a board follow the board's visibility" */
    it("lets the creator run, rename and delete a chart on it, and anyone use an unplaced one", async () => {
      const { app, repositories } = await privateBoardWithBlocks();
      await repositories.dashboards.createSavedWorkbenchChart({
        id: "chart-loose",
        projectId: PROJECT,
        name: "Loose",
        definition: { version: 1, sql: "SELECT 1", parameters: {} },
      });
      const mine = { projectId: PROJECT, chartId: "chart-placed", viewer: CREATOR };
      const loose = { projectId: PROJECT, chartId: "chart-loose", viewer: TEAMMATE };

      await expect(
        app.runSavedWorkbenchChart({ ...mine, actorId: CREATOR.userId }),
      ).resolves.toMatchObject({ rows: [] });
      await expect(
        app.updateMemberSavedWorkbenchChart({ ...mine, actorId: CREATOR.userId, name: "Mine" }),
      ).resolves.toMatchObject({ name: "Mine" });
      await expect(app.deleteSavedWorkbenchChart(mine)).resolves.toBeUndefined();

      await expect(app.getSavedWorkbenchChart(loose)).resolves.toMatchObject({ name: "Loose" });
      await expect(
        app.updateSavedWorkbenchChart({ projectId: PROJECT, chartId: "chart-loose", name: "Ours" }),
      ).resolves.toMatchObject({ name: "Ours" });
      await expect(app.deleteSavedWorkbenchChart(loose)).resolves.toBeUndefined();
    });
  });

  describe("given blocks on a board set to team", () => {
    /** @scenario "AC18 Blocks on a board follow the board's visibility" */
    it("shows them to the team and refuses them to a member outside it", async () => {
      const { app, id } = await boardSetTo("team");
      const placed = await app.createDashboardWidget({
        projectId: PROJECT,
        dashboardId: id,
        name: "Usage",
        code: "export default () => null;",
        queries: [],
        viewer: CREATOR,
      });

      await expect(
        app.listDashboardWidgets({ projectId: PROJECT, viewer: TEAMMATE }),
      ).resolves.toMatchObject([{ id: placed.id }]);
      await expect(
        app.listDashboardWidgets({ projectId: PROJECT, viewer: OUTSIDER }),
      ).resolves.toEqual([]);
      expect(
        await codeOf(
          app.deleteDashboardWidget({ projectId: PROJECT, id: placed.id, viewer: OUTSIDER }),
        ),
      ).toBe("dashboard_widget_not_found");
    });
  });

  describe("given a board with no recorded creator", () => {
    async function creatorlessBoard() {
      const repositories = MemoryDashboardRepositories.create();
      const board = await repositories.dashboards.createDashboard({
        id: "creatorless-board",
        projectId: PROJECT,
        name: "Reports",
        order: 0,
      });
      return { app: appWith({ repositories }), id: board.id };
    }

    /** @scenario "AC26 Narrowing a board with no recorded creator records who narrowed it" */
    it("records the member who set it to only me, who can still open it", async () => {
      const { app, id } = await creatorlessBoard();

      await expect(
        app.setDashboardVisibility({
          projectId: PROJECT,
          dashboardId: id,
          viewer: TEAMMATE,
          visibility: "only_me",
        }),
      ).resolves.toMatchObject({ visibility: "only_me", createdById: TEAMMATE.userId });
      await expect(
        app.getById({ projectId: PROJECT, dashboardId: id, viewer: TEAMMATE }),
      ).resolves.toMatchObject({ id });
      await expect(
        app.getAll({ projectId: PROJECT, graphCountScope: "builder", viewer: OUTSIDER }),
      ).resolves.toEqual([]);
    });

    it("records no one when it is left organisation-wide", async () => {
      const { app, id } = await creatorlessBoard();

      await expect(
        app.setDashboardVisibility({
          projectId: PROJECT,
          dashboardId: id,
          viewer: TEAMMATE,
          visibility: "organisation",
        }),
      ).resolves.toMatchObject({ createdById: null });
    });
  });

  describe("given an admin and another member's only-me board", () => {
    /** @scenario "AC26 An admin can manage a board they cannot see" */
    it("lets the admin change its visibility and delete it without listing or opening it", async () => {
      const { app, id } = await boardSetTo("only_me");
      const board = { projectId: PROJECT, dashboardId: id };

      await expect(
        app.getAll({ projectId: PROJECT, graphCountScope: "builder", viewer: ADMIN }),
      ).resolves.toEqual([]);
      expect(await codeOf(app.getById({ ...board, viewer: ADMIN }))).toBe("dashboard_not_found");
      expect(
        await codeOf(
          app.setDashboardVisibility({ ...board, viewer: TEAMMATE, visibility: "team" }),
        ),
      ).toBe("dashboard_not_found");

      await expect(
        app.setDashboardVisibility({ ...board, viewer: ADMIN, visibility: "only_me" }),
      ).resolves.toMatchObject({ createdById: CREATOR.userId });
      await expect(app.delete({ ...board, viewer: ADMIN })).resolves.toMatchObject({ id });
    });
  });

  describe("given a board created before visibility existed", () => {
    /** @scenario "AC24 Boards created before this change keep working" */
    it("stays organisation-wide, listed, openable and deletable as before", async () => {
      const repositories = MemoryDashboardRepositories.create();
      const legacy = await repositories.dashboards.createDashboard({
        id: "legacy-board",
        projectId: PROJECT,
        name: "Reports",
        order: 0,
      });
      const app = appWith({ repositories });

      expect(legacy).toMatchObject({ visibility: "organisation", createdById: null });
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

  describe("given a member's own board", () => {
    /** @scenario "AC14 Rename and describe" */
    it("saves a new name and description, and lists the new name", async () => {
      const { app, id } = await boardSetTo("only_me");

      await app.updateDashboardDetails({
        projectId: PROJECT,
        dashboardId: id,
        viewer: CREATOR,
        name: "Latency watch",
        description: "p95 by model",
      });

      await expect(
        app.getAll({ projectId: PROJECT, graphCountScope: "builder", viewer: CREATOR }),
      ).resolves.toMatchObject([{ id, name: "Latency watch", description: "p95 by model" }]);
    });
  });

  describe("when release_dashboards is off for the project", () => {
    /** @scenario "AC21 A refused member sees the same not-found page" */
    it("answers every Dashboards-area procedure with dashboards_not_enabled", async () => {
      const repositories = MemoryDashboardRepositories.create();
      const { id } = await boardSetTo("organisation", appWith({ repositories }));
      const app = appWith({ repositories, dashboardsEnabled: false });
      const board = { projectId: PROJECT, dashboardId: id, viewer: CREATOR };

      const codes = await Promise.all([
        codeOf(app.updateDashboardDetails({ ...board, name: "Off" })),
        codeOf(app.setDashboardVisibility({ ...board, visibility: "team" })),
        codeOf(app.getSourcePresence({ projectId: PROJECT, viewer: CREATOR })),
      ]);

      expect(codes).toEqual(Array(codes.length).fill("dashboards_not_enabled"));
    });

    it("leaves the procedures legacy analytics reads untouched", async () => {
      const app = appWith({ dashboardsEnabled: false });

      await expect(
        app.getOrCreateFirst({ projectId: PROJECT, viewer: CREATOR }),
      ).resolves.toMatchObject({
        name: "Reports",
        visibility: "organisation",
        createdById: CREATOR.userId,
      });
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
