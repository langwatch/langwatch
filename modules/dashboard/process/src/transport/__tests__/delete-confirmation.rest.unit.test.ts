/**
 * @vitest-environment node
 * A delete card's record name, read as the key's owner over the real app and memory repositories.
 * Spec: specs/langy/langy-delete-confirmation.feature.
 */
import type { RestTransportDeclaration } from "@langwatch/api/rest";
import type { DashboardApi } from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import { createDashboardTestApp } from "../../app/__tests__/dashboard.fixture.ts";
import type { DashboardRecord } from "../../repositories/dashboard.repository.ts";
import { MemoryBoardRepository } from "../../repositories/memory/memory.board.repository.ts";
import { MemoryDashboardWidgetRepository } from "../../repositories/memory/memory.dashboard-widget.repository.ts";
import { MemoryDashboardDatabase } from "../../repositories/memory/memory.dashboard.database.ts";
import { MemoryDashboardRepository } from "../../repositories/memory/memory.dashboard.repository.ts";
import { MemorySavedViewRepository } from "../../repositories/memory/memory.saved-view.repository.ts";
import { dashboardWidgetRest } from "../dashboard-widget.rest.ts";
import { dashboardRest } from "../dashboard.rest.ts";
import { graphRest } from "../graph.rest.ts";
import { savedWorkbenchChartRest } from "../saved-workbench-chart.rest.ts";

const PROJECT = "project-1";
const OWNER = { userId: "user-2" };

/** The app over memory repositories whose shared tables the test can also write. */
function appWithDatabase() {
  const database = MemoryDashboardDatabase.create();
  const dashboards = MemoryDashboardRepository.create({ database });
  const app = createDashboardTestApp({
    repositories: {
      boards: MemoryBoardRepository.create({ database }),
      dashboards,
      dashboardWidgets: MemoryDashboardWidgetRepository.create({ database }),
      savedViews: MemorySavedViewRepository.create(),
    },
  });
  return { app, database, dashboards };
}

/**
 * A Reports board at Only me for `OWNER`. No app method makes one, as a Reports create is at the
 * scope Project with no author, so the row is written in the shared table directly.
 */
async function privateReportsBoard({ app, database }: ReturnType<typeof appWithDatabase>) {
  const reports = await app.create({ projectId: PROJECT, name: "Private" });
  const makePrivate = () => {
    database.dashboards = database.dashboards.map((row): DashboardRecord =>
      row.id === reports.id ? { ...row, scope: "PRIVATE", createdById: OWNER.userId } : row,
    );
  };
  return { reports, makePrivate };
}

/** The delete mark a router declares for `resource`. */
function markOf(router: RestTransportDeclaration<DashboardApi>, resource: string) {
  const mark = router.routes.find(
    (route) => route.confirmation?.resource === resource,
  )?.confirmation;
  if (!mark) throw new Error(`no confirmation for ${resource}`);
  return mark;
}

/** The card's name for each key: its owner, another member, and a key that names nobody. */
async function namesFor({
  app,
  mark,
  id,
}: {
  app: DashboardApi;
  mark: ReturnType<typeof markOf>;
  id: string;
}) {
  const nameFor = (ownerUserId: string | null) =>
    mark.name({ app, projectId: PROJECT, id, ownerUserId });
  // A name means a card; undefined means gone, and the handler would answer for it alone.
  return {
    owner: await nameFor(OWNER.userId),
    other: await nameFor("user-3"),
    nobody: await nameFor(null),
  };
}

describe("a Langy key's delete card for a record on its owner's Only me board", () => {
  describe("when the record is a Reports dashboard", () => {
    /** @scenario "A Langy key's delete card names the key owner's own Only me records" */
    it("names it for its owner, and for nobody else", async () => {
      const setup = appWithDatabase();
      const { reports, makePrivate } = await privateReportsBoard(setup);
      makePrivate();

      const names = await namesFor({
        app: setup.app,
        mark: markOf(dashboardRest.router(), "dashboard"),
        id: reports.id,
      });

      expect(names).toEqual({ owner: "Private", other: undefined, nobody: undefined });
    });
  });

  describe("when the record is a graph on that board", () => {
    /** @scenario "A Langy key's delete card names the key owner's own Only me records" */
    it("names it for its owner, and for nobody else", async () => {
      const setup = appWithDatabase();
      const { reports, makePrivate } = await privateReportsBoard(setup);
      const graph = await setup.app.createGraph({
        projectId: PROJECT,
        name: "Latency",
        graph: { graphType: "line" },
        dashboardId: reports.id,
      });
      makePrivate();

      const names = await namesFor({
        app: setup.app,
        mark: markOf(graphRest.router(), "graph"),
        id: graph.id,
      });

      expect(names).toEqual({ owner: "Latency", other: undefined, nobody: undefined });
    });
  });

  describe("when the record is a saved chart on that board", () => {
    async function placedChart() {
      const setup = appWithDatabase();
      const { reports, makePrivate } = await privateReportsBoard(setup);
      await setup.dashboards.createSavedWorkbenchChart({
        id: "chart-1",
        projectId: PROJECT,
        name: "Spend",
        definition: { version: 1, sql: "SELECT 1", parameters: {} },
      });
      await setup.app.placeSavedWorkbenchChart({
        projectId: PROJECT,
        chartId: "chart-1",
        dashboardId: reports.id,
      });
      makePrivate();
      return setup.app;
    }

    /** @scenario "A Langy key's delete card names the key owner's own Only me records" */
    it("names it on the delete card for its owner, and for nobody else", async () => {
      const app = await placedChart();

      const names = await namesFor({
        app,
        mark: markOf(savedWorkbenchChartRest.router(), "chart"),
        id: "chart-1",
      });

      expect(names).toEqual({ owner: "Spend", other: undefined, nobody: undefined });
    });

    /** @scenario "A Langy key's delete card names the key owner's own Only me records" */
    it("names it on the remove-from-board card for its owner, and for nobody else", async () => {
      const app = await placedChart();

      const names = await namesFor({
        app,
        mark: markOf(savedWorkbenchChartRest.router(), "dashboard chart"),
        id: "chart-1",
      });

      expect(names).toEqual({ owner: "Spend", other: undefined, nobody: undefined });
    });
  });

  describe("when the record is a widget on an Only me Dashboards board", () => {
    /** @scenario "A Langy key's delete card names the key owner's own Only me records" */
    it("names it for its owner, and for nobody else", async () => {
      const { app } = appWithDatabase();
      const board = await app.createBoard({
        projectId: PROJECT,
        name: "Private",
        createdById: OWNER.userId,
      });
      const widget = await app.createDashboardWidget({
        projectId: PROJECT,
        dashboardId: board.id,
        name: "Traces",
        code: "export default () => null;",
        queries: [],
        viewer: OWNER,
      });
      await app.setDashboardScope({
        projectId: PROJECT,
        dashboardId: board.id,
        scope: "PRIVATE",
        viewer: OWNER,
      });

      const names = await namesFor({
        app,
        mark: markOf(dashboardWidgetRest.router(), "dashboard widget"),
        id: widget.id,
      });

      expect(names).toEqual({ owner: "Traces", other: undefined, nobody: undefined });
    });
  });
});
