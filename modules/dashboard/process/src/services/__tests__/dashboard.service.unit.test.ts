/**
 * The project's dashboards and the graphs placed on them, over the memory
 * repository the Prisma one is the twin of. Spec: dashboard-service.feature.
 */
import {
  DashboardNotFoundError,
  DashboardReorderUnknownIdsError,
  GraphNotFoundError,
} from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import { MemoryDashboardRepository } from "../../repositories/memory/memory.dashboard.repository.ts";
import type { WorkbenchAccess } from "../dashboard.service.ts";
import { DashboardService } from "../dashboard.service.ts";

class FixedWorkbenchAccess implements WorkbenchAccess {
  constructor(private readonly enabled: boolean) {}

  async isWorkbenchEnabled(): Promise<boolean> {
    return this.enabled;
  }
}

function serviceWith(workbenchEnabled = true) {
  const repository = MemoryDashboardRepository.create();

  return {
    repository,
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

  describe("given a member creates a dashboard", () => {
    /** @scenario "AC156 Creating, duplicating or adding from a template stars the board for its creator" */
    it("stars it for the creator, and lists it starred for them", async () => {
      const { service } = serviceWith();

      const created = await service.create({
        projectId: PROJECT,
        name: "Reports",
        createdById: "member-1",
      });

      expect(created.createdById).toBe("member-1");
      await expect(
        service.listStarred({ projectId: PROJECT, userId: "member-1" }),
      ).resolves.toMatchObject([{ id: created.id }]);
    });

    /** @scenario "AC156 Creating, duplicating or adding from a template stars the board for its creator" */
    it("stars it for nobody when a project credential creates it", async () => {
      const { service } = serviceWith();

      const created = await service.create({ projectId: PROJECT, name: "Reports" });

      expect(created.createdById).toBeNull();
      const [listed] = await service.getAll({ projectId: PROJECT, graphCountScope: "builder" });
      expect(listed?.isStarred).toBe(false);
    });
  });

  describe("given one member's stars", () => {
    /** @scenario "AC157 Stars are per member" */
    it("does not show them to another member", async () => {
      const { service } = serviceWith();
      const board = await service.create({ projectId: PROJECT, name: "Reports", createdById: "a" });

      await expect(service.listStarred({ projectId: PROJECT, userId: "a" })).resolves.toMatchObject(
        [{ id: board.id }],
      );
      await expect(service.listStarred({ projectId: PROJECT, userId: "b" })).resolves.toEqual([]);

      const forB = await service.getAll({
        projectId: PROJECT,
        graphCountScope: "builder",
        viewer: { userId: "b" },
      });
      expect(forB.map((board) => board.isStarred)).toEqual([false]);
    });

    it("appends a star at the end and is idempotent", async () => {
      const { service } = serviceWith();
      const first = await service.create({ projectId: PROJECT, name: "One", createdById: "a" });
      const second = await service.create({ projectId: PROJECT, name: "Two" });
      const third = await service.create({ projectId: PROJECT, name: "Three" });

      await service.star({ projectId: PROJECT, userId: "a", dashboardId: third.id });
      await service.star({ projectId: PROJECT, userId: "a", dashboardId: second.id });
      // Starring twice changes nothing.
      await service.star({ projectId: PROJECT, userId: "a", dashboardId: third.id });

      await expect(service.listStarred({ projectId: PROJECT, userId: "a" })).resolves.toMatchObject(
        [{ id: first.id }, { id: third.id }, { id: second.id }],
      );
    });

    it("unstars a board and reorders the rest", async () => {
      const { service } = serviceWith();
      const a = await service.create({ projectId: PROJECT, name: "A", createdById: "u" });
      const b = await service.create({ projectId: PROJECT, name: "B", createdById: "u" });
      const c = await service.create({ projectId: PROJECT, name: "C", createdById: "u" });

      await service.unstar({ projectId: PROJECT, userId: "u", dashboardId: b.id });
      await expect(service.listStarred({ projectId: PROJECT, userId: "u" })).resolves.toMatchObject(
        [{ id: a.id }, { id: c.id }],
      );

      await service.reorderStars({ projectId: PROJECT, userId: "u", dashboardIds: [c.id, a.id] });
      await expect(service.listStarred({ projectId: PROJECT, userId: "u" })).resolves.toMatchObject(
        [{ id: c.id }, { id: a.id }],
      );
    });

    /** @scenario "AC26 Deleting a board removes it from every member's stars" */
    it("removes the board from every member's stars when it is deleted", async () => {
      const { service } = serviceWith();
      const board = await service.create({ projectId: PROJECT, name: "Shared", createdById: "a" });
      await service.star({ projectId: PROJECT, userId: "b", dashboardId: board.id });

      await service.delete({ projectId: PROJECT, dashboardId: board.id });

      await expect(service.listStarred({ projectId: PROJECT, userId: "a" })).resolves.toEqual([]);
      await expect(service.listStarred({ projectId: PROJECT, userId: "b" })).resolves.toEqual([]);
    });

    it("refuses a star on a board the project does not have", async () => {
      const { service } = serviceWith();

      await expect(
        service.star({ projectId: PROJECT, userId: "a", dashboardId: "missing" }),
      ).rejects.toBeInstanceOf(DashboardNotFoundError);
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
});
