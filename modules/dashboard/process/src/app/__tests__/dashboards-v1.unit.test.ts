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
      ).resolves.toMatchObject({ name: "Reports", visibility: "organisation" });
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
