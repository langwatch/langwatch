/**
 * The Analytics Reports boards and the graphs placed on them, over the memory
 * repository the Prisma one is the twin of. Spec: dashboard-service.feature,
 * dashboards-v2.feature AC199 to AC199m.
 */
import type { AnalyticsApi } from "@langwatch/analytics-contract";
import {
  DashboardNotFoundError,
  DashboardReorderUnknownIdsError,
  GraphNotFoundError,
} from "@langwatch/dashboard-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  createDashboardTestAuthz,
  createDashboardTestProjects,
  DASHBOARDS_ROLLED_OUT,
} from "../../app/__tests__/dashboard.fixture.ts";
import { MemoryBoardRepository } from "../../repositories/memory/memory.board.repository.ts";
import { MemoryDashboardWidgetRepository } from "../../repositories/memory/memory.dashboard-widget.repository.ts";
import { MemoryDashboardDatabase } from "../../repositories/memory/memory.dashboard.database.ts";
import { MemoryDashboardRepository } from "../../repositories/memory/memory.dashboard.repository.ts";
import { BoardService } from "../board.service.ts";
import { DashboardAccessService } from "../dashboard-access.service.ts";
import type { WorkbenchAccess } from "../dashboard.service.ts";
import { DashboardService } from "../dashboard.service.ts";
import { SavedWorkbenchChartPolicyService } from "../saved-workbench-chart-policy.service.ts";
import { SavedWorkbenchChartService } from "../saved-workbench-chart.service.ts";

class FixedWorkbenchAccess implements WorkbenchAccess {
  constructor(private readonly enabled: boolean) {}

  async isWorkbenchEnabled(): Promise<boolean> {
    return this.enabled;
  }
}

function serviceWith(workbenchEnabled = true) {
  const database = MemoryDashboardDatabase.create();
  const widgets = MemoryDashboardWidgetRepository.create({ database });
  const repository = MemoryDashboardRepository.create({ database });
  const boards = MemoryBoardRepository.create({ database });
  const access = DashboardAccessService.create({
    repository: boards,
    projects: createDashboardTestProjects(),
    rollout: DASHBOARDS_ROLLED_OUT,
    authz: createDashboardTestAuthz(),
  });

  return {
    database,
    repository,
    boards,
    widgets,
    boardService: BoardService.create({ repository: boards, access }),
    service: DashboardService.create({
      repository,
      workbenchAccess: new FixedWorkbenchAccess(workbenchEnabled),
    }),
  };
}

const PROJECT = "project_1";

async function dashboardWithBothChartKinds(workbenchEnabled = true) {
  const { service, repository } = serviceWith(workbenchEnabled);
  const dashboard = await service.create({ projectId: PROJECT, name: "Reports" });

  await service.createGraph({
    projectId: PROJECT,
    name: "Latency",
    graph: { graphType: "line" },
    dashboardId: dashboard.id,
  });
  await repository.createSavedWorkbenchChart({
    id: "chart_1",
    projectId: PROJECT,
    name: "Spend",
    definition: { version: 1, sql: "SELECT 1", parameters: {} },
  });
  await repository.placeSavedWorkbenchChart({
    projectId: PROJECT,
    chartId: "chart_1",
    dashboardId: dashboard.id,
    gridColumn: 0,
    gridRow: 5,
    colSpan: 1,
    rowSpan: 1,
  });

  return { service, repository, dashboard };
}

describe("DashboardService", () => {
  describe("given a dashboard holding a builder graph and a workbench chart", () => {
    /** @scenario "The dashboard list counts exactly the cards the grid will render" */
    it("counts every kind the project may place", async () => {
      const { service } = await dashboardWithBothChartKinds();

      const [listed] = await service.getAll({
        projectId: PROJECT,
        graphCountScope: "placeable",
      });

      expect(listed?.graphCount).toBe(2);
    });

    /** @scenario "The dashboard list counts exactly the cards the grid will render" */
    it("counts only builder graphs for a list whose detail returns only builders", async () => {
      const { service } = await dashboardWithBothChartKinds();

      const [listed] = await service.getAll({ projectId: PROJECT, graphCountScope: "builder" });

      expect(listed?.graphCount).toBe(1);
    });

    /** @scenario "A saved workbench chart is not exposed through the dashboard REST API" */
    /** @scenario "The list's graphCount matches what the detail response actually returns" */
    it("returns only the builder graph on the detail, and the REST list counts that many", async () => {
      const { service } = await dashboardWithBothChartKinds();

      const [listed] = await service.getAll({ projectId: PROJECT, graphCountScope: "builder" });
      const detail = await service.getById({ projectId: PROJECT, dashboardId: listed?.id ?? "" });

      expect(detail.graphs).toHaveLength(1);
      expect(JSON.stringify(detail)).not.toContain("SELECT 1");
      expect(listed?.graphCount).toBe(detail.graphs.length);
    });

    /** @scenario "The dashboard's card procedures admit workbench rows only when the workbench flag is on" */
    it("admits the workbench chart with the flag on and the builder graph alone with it off", async () => {
      const on = await dashboardWithBothChartKinds(true);
      const off = await dashboardWithBothChartKinds(false);

      const [admitted] = await on.service.getAll({
        projectId: PROJECT,
        graphCountScope: "placeable",
      });
      const [builderOnly] = await off.service.getAll({
        projectId: PROJECT,
        graphCountScope: "placeable",
      });

      expect([admitted?.graphCount, builderOnly?.graphCount]).toEqual([2, 1]);
    });

    describe("when the project may not place workbench cards", () => {
      it("counts only the builder graphs it can draw", async () => {
        const { service } = await dashboardWithBothChartKinds(false);

        const [listed] = await service.getAll({
          projectId: PROJECT,
          graphCountScope: "placeable",
        });

        expect(listed?.graphCount).toBe(1);
      });
    });

    /** @scenario "A graph is placed after every chart in the shared grid" */
    it("places a new builder graph after the workbench chart already on the grid", async () => {
      const { service, dashboard } = await dashboardWithBothChartKinds();

      const created = await service.createGraph({
        projectId: PROJECT,
        name: "Errors",
        graph: { graphType: "line" },
        dashboardId: dashboard.id,
      });

      expect(created.gridRow).toBe(6);
    });
  });

  describe("given a dashboard whose chart at row 0 spans three rows", () => {
    /** @scenario "A new graph is placed below the bottom edge of the tallest chart" */
    it("places a new graph on row 3, below that chart's bottom edge", async () => {
      const { service } = serviceWith();
      const dashboard = await service.create({ projectId: PROJECT, name: "Reports" });
      await service.createGraph({
        projectId: PROJECT,
        name: "Latency",
        graph: { graphType: "line" },
        dashboardId: dashboard.id,
        layout: { gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 3 },
      });

      const created = await service.createGraph({
        projectId: PROJECT,
        name: "Errors",
        graph: { graphType: "line" },
        dashboardId: dashboard.id,
      });

      expect(created.gridRow).toBe(3);
    });
  });

  describe("given a project with dashboards already in it", () => {
    /** @scenario "A dashboard is created after the project's current dashboards" */
    it("creates each new dashboard after the current last", async () => {
      const { service } = serviceWith();

      const first = await service.create({ projectId: PROJECT, name: "Reports" });
      const second = await service.create({ projectId: PROJECT, name: "Quality" });

      expect([first.order, second.order]).toEqual([0, 1]);
    });
  });

  describe("given a dashboard belonging to another project", () => {
    /** @scenario "A dashboard from another project cannot be renamed" */
    it("refuses the rename as one this project does not have", async () => {
      const { service } = serviceWith();
      const dashboard = await service.create({ projectId: PROJECT, name: "Reports" });

      await expect(
        service.rename({
          projectId: "project_2",
          dashboardId: dashboard.id,
          name: "Nope",
        }),
      ).rejects.toBeInstanceOf(DashboardNotFoundError);
    });
  });

  describe("given a reorder naming an id the project does not have", () => {
    it("reports every missing id and writes no order at all", async () => {
      const { service } = serviceWith();
      const dashboard = await service.create({ projectId: PROJECT, name: "Reports" });

      const error = await service
        .reorder({ projectId: PROJECT, dashboardIds: [dashboard.id, "dashboard_2"] })
        .catch((caught: DashboardReorderUnknownIdsError) => caught);

      expect(error).toBeInstanceOf(DashboardReorderUnknownIdsError);
      expect((error as DashboardReorderUnknownIdsError).missingIds).toEqual(["dashboard_2"]);
      await expect(
        service.getAll({ projectId: PROJECT, graphCountScope: "builder" }),
      ).resolves.toMatchObject([{ order: 0 }]);
    });
  });

  describe("given a graph belonging to another project", () => {
    it("refuses the read as one this project does not have", async () => {
      const { service } = serviceWith();
      const dashboard = await service.create({ projectId: PROJECT, name: "Reports" });
      const graph = await service.createGraph({
        projectId: PROJECT,
        name: "Latency",
        graph: { graphType: "line" },
        dashboardId: dashboard.id,
      });

      await expect(
        service.getGraph({ projectId: "project_2", graphId: graph.id }),
      ).rejects.toBeInstanceOf(GraphNotFoundError);
    });
  });

  describe("given a graph created with an empty dashboard id", () => {
    /** @scenario "A graph created with an empty dashboard id is placed on no dashboard" */
    it("stores it on no dashboard", async () => {
      const { service } = serviceWith();

      const created = await service.createGraph({
        projectId: PROJECT,
        name: "Latency",
        graph: {},
        dashboardId: "",
      });

      expect(created.dashboardId).toBeNull();
    });
  });

  describe("given a graph name of twenty thousand characters", () => {
    const name = "A".repeat(20_000);

    /** @scenario "A graph name has no length limit" */
    it("renames a known graph to it", async () => {
      const { service } = serviceWith();
      const graph = await service.createGraph({ projectId: PROJECT, name: "Latency", graph: {} });

      const updated = await service.updateGraph({ projectId: PROJECT, graphId: graph.id, name });

      expect(updated.name).toBe(name);
    });

    /** @scenario "A graph name has no length limit" */
    it("answers an unknown graph as not found rather than as invalid", async () => {
      const { service } = serviceWith();

      await expect(
        service.updateGraph({ projectId: PROJECT, graphId: "graph_missing", name }),
      ).rejects.toBeInstanceOf(GraphNotFoundError);
    });
  });

  describe("given a Reports board, a board only Dashboards holds and a mixed board", () => {
    const viewer = { userId: "member" };
    const WIDGET = { name: "Usage", code: "export default () => null;", queries: [] };

    /** The split's three classes: each in Dashboard, DashboardsV2 or both, under one id. */
    async function threeBoards() {
      const built = serviceWith();
      const { service, repository, boards, widgets, database } = built;
      const reports = await service.create({ projectId: PROJECT, name: "Reports" });
      await service.createGraph({
        projectId: PROJECT,
        name: "Latency",
        graph: { graphType: "line" },
        dashboardId: reports.id,
      });
      const moved = await repository.createDashboard({
        id: "board_moved",
        projectId: PROJECT,
        name: "Moved",
        order: 1,
      });
      await boards.createBoard({ id: moved.id, projectId: PROJECT, name: moved.name });
      // The split leaves a widget's srcdoc row behind in CustomGraph: a stale copy, not a chart.
      database.charts.push({
        id: "widget_moved",
        projectId: PROJECT,
        name: "Usage",
        kind: "dashboard_srcdoc",
        graph: {},
        filters: null,
        dashboardId: moved.id,
        gridColumn: 0,
        gridRow: 0,
        colSpan: 1,
        rowSpan: 1,
        createdAt: database.now(),
        updatedAt: database.now(),
      });
      await widgets.createWidget({
        id: "widget_moved",
        projectId: PROJECT,
        dashboardId: moved.id,
        input: WIDGET,
      });
      const mixed = await service.create({ projectId: PROJECT, name: "Shop assistant health" });
      await boards.createBoard({ id: mixed.id, projectId: PROJECT, name: mixed.name });
      await widgets.createWidget({
        id: "widget_mixed",
        projectId: PROJECT,
        dashboardId: mixed.id,
        input: WIDGET,
      });
      await repository.createSavedWorkbenchChart({
        id: "chart_1",
        projectId: PROJECT,
        name: "Spend",
        definition: { version: 1, sql: "SELECT 1", parameters: {} },
      });
      await repository.placeSavedWorkbenchChart({
        projectId: PROJECT,
        chartId: "chart_1",
        dashboardId: mixed.id,
        gridColumn: 0,
        gridRow: 5,
        colSpan: 1,
        rowSpan: 1,
      });
      return { ...built, reports, moved, mixed };
    }

    const reportsIds = async (service: DashboardService) =>
      (await service.getAll({ projectId: PROJECT, graphCountScope: "placeable", viewer }))
        .map(({ id }) => id)
        .toSorted();

    /** @scenario "AC199 Split: Dashboards and Analytics Reports each list and open only their own boards" */
    it("lists the Reports and the mixed board in Reports, and Dashboards lists its own two", async () => {
      const { service, boardService, reports, moved, mixed } = await threeBoards();

      expect({
        reports: await reportsIds(service),
        dashboards: (await boardService.findBoards({ projectId: PROJECT, viewer }))
          .map(({ id }) => id)
          .toSorted(),
        opened: await boardService
          .getBoard({ projectId: PROJECT, dashboardId: reports.id, viewer })
          .catch((error: { code: string }) => error.code),
      }).toEqual({
        reports: [reports.id, mixed.id].toSorted(),
        dashboards: [moved.id, mixed.id].toSorted(),
        opened: "dashboard_not_found",
      });
    });

    /** @scenario "AC199c Legacy board: Langy saves a chart only onto a board made in Analytics Reports" */
    it("offers no board only Dashboards holds for a builder chart to land on", async () => {
      const { service, moved } = await threeBoards();

      await expect(reportsIds(service)).resolves.not.toContain(moved.id);
    });

    /** @scenario "AC199j Split: a Reports write refuses the id of a board only Dashboards holds" */
    it("answers a rename, delete or reorder of a board only Dashboards holds as not found", async () => {
      const { service, boardService, moved } = await threeBoards();
      const on = { projectId: PROJECT, dashboardId: moved.id, viewer };
      const codeOf = (call: Promise<unknown>) =>
        call.then(
          () => "<resolved>",
          (error: { code: string }) => error.code,
        );

      expect({
        rename: await codeOf(service.rename({ ...on, name: "Taken" })),
        delete: await codeOf(service.delete(on)),
        reorder: await codeOf(service.reorder({ projectId: PROJECT, dashboardIds: [moved.id] })),
        opened: await codeOf(service.getById(on)),
        board: (await boardService.getBoard(on)).name,
      }).toEqual({
        rename: "dashboard_not_found",
        delete: "dashboard_not_found",
        reorder: "dashboard_reorder_unknown_ids",
        opened: "dashboard_not_found",
        board: "Moved",
      });
    });

    /** @scenario "AC199j Split: a Reports write refuses the id of a board only Dashboards holds" */
    it("never lands the Reports area on a board only Dashboards holds as its first", async () => {
      const { service, repository, boards } = serviceWith();
      const moved = { id: "board_moved", projectId: PROJECT, name: "Moved" };
      await repository.createDashboard({ ...moved, order: 0 });
      await boards.createBoard(moved);

      const [first] = await service.getOrCreateFirst({ projectId: PROJECT, acceptsWrites: true });

      expect({ name: first?.name, isMoved: first?.id === moved.id }).toEqual({
        name: "Reports",
        isMoved: false,
      });
    });

    /** @scenario "AC199k Split: a saved workbench chart is placed only on a Reports board" */
    it("places a saved workbench chart on a Reports board and not on one only Dashboards holds", async () => {
      const { repository, reports, moved } = await threeBoards();
      const analytics = createApiFixture<AnalyticsApi>({});
      const charts = SavedWorkbenchChartService.create({
        repository,
        policy: SavedWorkbenchChartPolicyService.create({ analytics }),
        analytics,
      });
      await repository.createSavedWorkbenchChart({
        id: "chart_2",
        projectId: PROJECT,
        name: "Errors",
        definition: { version: 1, sql: "SELECT 1", parameters: {} },
      });
      const placedOn = (dashboardId: string) =>
        charts.place({ projectId: PROJECT, chartId: "chart_2", dashboardId }).then(
          (chart) => chart.dashboardId,
          (error: { code: string }) => error.code,
        );

      expect({
        dashboards: await placedOn(moved.id),
        reports: await placedOn(reports.id),
      }).toEqual({
        dashboards: "saved_workbench_chart_dashboard_not_found",
        reports: reports.id,
      });
    });

    /** @scenario "AC199d Split: a Reports delete leaves the Dashboards area unchanged" */
    it("deletes the mixed board from Reports and leaves its Dashboards board and widget", async () => {
      const { service, boardService, widgets, mixed } = await threeBoards();

      await service.delete({ projectId: PROJECT, dashboardId: mixed.id, viewer });

      expect({
        reports: (await reportsIds(service)).includes(mixed.id),
        board: (await boardService.getBoard({ projectId: PROJECT, dashboardId: mixed.id })).id,
        widgets: (await widgets.findAll({ projectId: PROJECT }))
          .filter((widget) => widget.dashboardId === mixed.id)
          .map(({ id }) => id),
      }).toEqual({ reports: false, board: mixed.id, widgets: ["widget_mixed"] });
    });

    /** @scenario "AC199m Split: Analytics Reports keeps another member's Only me board hidden" */
    it("hides another member's Only me mixed board and its charts, and shows them to its author", async () => {
      const { service, repository, database, mixed } = await threeBoards();
      const graph = await service.createGraph({
        projectId: PROJECT,
        name: "Errors",
        graph: { graphType: "line" },
        dashboardId: mixed.id,
      });
      database.dashboards = database.dashboards.map((row) =>
        row.id === mixed.id
          ? { ...row, scope: "PRIVATE" as const, createdById: viewer.userId }
          : row,
      );
      const analytics = createApiFixture<AnalyticsApi>({});
      const charts = SavedWorkbenchChartService.create({
        repository,
        policy: SavedWorkbenchChartPolicyService.create({ analytics }),
        analytics,
      });
      const codeOf = (call: Promise<unknown>) =>
        call.then(
          () => "<resolved>",
          (error: { code: string }) => error.code,
        );
      const readBy = async (reader?: { userId: string }) => {
        const on = { projectId: PROJECT, viewer: reader };
        const board = { ...on, dashboardId: mixed.id };
        return {
          listed: (await service.getAll({ ...on, graphCountScope: "placeable" }))
            .map(({ id }) => id)
            .includes(mixed.id),
          opened: await codeOf(service.getById(board)),
          renamed: await codeOf(service.rename({ ...board, name: mixed.name })),
          graphs: (await service.listGraphs(on)).map(({ id }) => id).includes(graph.id),
          graph: await codeOf(service.getGraph({ ...on, graphId: graph.id })),
          savedCharts: (await charts.getAll(on)).map(({ id }) => id),
          savedChart: await codeOf(charts.getById({ ...on, chartId: "chart_1" })),
        };
      };
      const hidden = {
        listed: false,
        opened: "dashboard_not_found",
        renamed: "dashboard_not_found",
        graphs: false,
        graph: "graph_not_found",
        savedCharts: [],
        savedChart: "saved_workbench_chart_not_found",
      };

      expect({
        author: await readBy(viewer),
        member: await readBy({ userId: "other-member" }),
        credential: await readBy(),
      }).toEqual({
        author: {
          listed: true,
          opened: "<resolved>",
          renamed: "<resolved>",
          graphs: true,
          graph: "<resolved>",
          savedCharts: ["chart_1"],
          savedChart: "<resolved>",
        },
        member: hidden,
        credential: hidden,
      });
    });
  });
});

describe("DashboardService.getOrCreateFirst", () => {
  describe("given a project with no dashboard that takes writes", () => {
    it("creates the first one", async () => {
      const { service } = serviceWith();

      const [first] = await service.getOrCreateFirst({ projectId: PROJECT, acceptsWrites: true });

      expect(first?.name).toBe("Reports");
    });
  });

  describe("given an aggregate project with no dashboard", () => {
    it("creates nothing and returns none", async () => {
      const { service } = serviceWith();

      await expect(
        service.getOrCreateFirst({ projectId: PROJECT, acceptsWrites: false }),
      ).resolves.toEqual([]);
      await expect(
        service.getAll({ projectId: PROJECT, graphCountScope: "builder" }),
      ).resolves.toEqual([]);
    });
  });

  describe("given an aggregate project that already has a dashboard", () => {
    it("returns it", async () => {
      const { service } = serviceWith();
      const existing = await service.create({ projectId: PROJECT, name: "Mine" });

      const [first] = await service.getOrCreateFirst({ projectId: PROJECT, acceptsWrites: false });

      expect(first?.id).toBe(existing.id);
    });
  });
});
