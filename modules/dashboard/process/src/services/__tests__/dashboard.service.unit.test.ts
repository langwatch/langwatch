/**
 * The project's dashboards and the graphs placed on them, over the memory
 * repository the Prisma one is the twin of. Spec: dashboard-service.feature.
 */
import {
  DashboardNotFoundError,
  DashboardReorderUnknownIdsError,
  GraphNotFoundError,
  MY_DASHBOARD_NAME,
} from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import { createDashboardTestProjects } from "../../app/__tests__/dashboard.fixture.ts";
import { MemoryDashboardRepository } from "../../repositories/memory/memory.dashboard.repository.ts";
import { DashboardAccessService } from "../dashboard-access.service.ts";
import { DashboardStarService } from "../dashboard-star.service.ts";
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
  const access = DashboardAccessService.create({
    repository,
    projects: createDashboardTestProjects(),
  });

  return {
    repository,
    stars: DashboardStarService.create({ repository, access }),
    service: DashboardService.create({
      repository,
      workbenchAccess: new FixedWorkbenchAccess(workbenchEnabled),
      access,
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
    /** @scenario "AC156 No board is starred unless the member stars it" */
    it("stars it for nobody, the creator included", async () => {
      const { service, stars } = serviceWith();

      const created = await service.create({
        projectId: PROJECT,
        name: "Reports",
        createdById: "member-1",
      });

      expect(created.createdById).toBe("member-1");
      await expect(stars.listStarred({ projectId: PROJECT, userId: "member-1" })).resolves.toEqual(
        [],
      );
      const [listed] = await service.getAll({
        projectId: PROJECT,
        graphCountScope: "builder",
        viewer: { userId: "member-1" },
      });
      expect(listed?.isStarred).toBe(false);
    });
  });

  describe("given a member's My dashboard is made", () => {
    const myDashboard = (service: DashboardService) =>
      service.create({ projectId: PROJECT, name: MY_DASHBOARD_NAME, createdById: "member-1" });
    const starredIds = async (stars: DashboardStarService, userId: string) =>
      (await stars.listStarred({ projectId: PROJECT, userId })).map((entry) =>
        entry.kind === "board" ? entry.dashboard.id : entry.templateId,
      );

    /** @scenario "AC160b A member with no My dashboard gets one made, starred for them" */
    it("stars it for its maker and for nobody else", async () => {
      const { service, stars } = serviceWith();

      const created = await myDashboard(service);

      await expect(starredIds(stars, "member-1")).resolves.toEqual([created.id]);
      await expect(starredIds(stars, "member-2")).resolves.toEqual([]);
      const [listed] = await service.getAll({
        projectId: PROJECT,
        graphCountScope: "builder",
        viewer: { userId: "member-1" },
      });
      expect(listed?.isStarred).toBe(true);
    });

    /** @scenario "AC160c A member who unstars My dashboard keeps it unstarred" */
    it("keeps it unstarred once its maker unstars it", async () => {
      const { service, stars } = serviceWith();
      const created = await myDashboard(service);

      await stars.unstar({
        projectId: PROJECT,
        userId: "member-1",
        star: { kind: "board", dashboardId: created.id },
      });
      await service.getOrCreateFirst({ projectId: PROJECT, viewer: { userId: "member-1" } });

      await expect(starredIds(stars, "member-1")).resolves.toEqual([]);
    });

    it("stars nobody when the board has no maker", async () => {
      const { service, stars } = serviceWith();

      await service.create({ projectId: PROJECT, name: MY_DASHBOARD_NAME });

      await expect(starredIds(stars, "member-1")).resolves.toEqual([]);
    });
  });

  describe("given one member's stars", () => {
    const board = (dashboardId: string) => ({ kind: "board" as const, dashboardId });
    const template = (templateId: string) => ({ kind: "template" as const, templateId });
    const listed = async (stars: DashboardStarService, userId: string) =>
      (await stars.listStarred({ projectId: PROJECT, userId })).map((entry) =>
        entry.kind === "board" ? entry.dashboard.id : `template:${entry.templateId}`,
      );

    /** @scenario "AC157 Stars are per member" */
    it("does not show them to another member", async () => {
      const { service, stars } = serviceWith();
      const created = await service.create({ projectId: PROJECT, name: "Reports" });
      await stars.star({ projectId: PROJECT, userId: "a", star: board(created.id) });

      await expect(listed(stars, "a")).resolves.toEqual([created.id]);
      await expect(listed(stars, "b")).resolves.toEqual([]);

      const forB = await service.getAll({
        projectId: PROJECT,
        graphCountScope: "builder",
        viewer: { userId: "b" },
      });
      expect(forB.map((entry) => entry.isStarred)).toEqual([false]);
    });

    it("appends a star at the end and is idempotent", async () => {
      const { service, stars } = serviceWith();
      const first = await service.create({ projectId: PROJECT, name: "One" });
      const second = await service.create({ projectId: PROJECT, name: "Two" });
      const third = await service.create({ projectId: PROJECT, name: "Three" });

      await stars.star({ projectId: PROJECT, userId: "a", star: board(first.id) });
      await stars.star({ projectId: PROJECT, userId: "a", star: board(third.id) });
      await stars.star({ projectId: PROJECT, userId: "a", star: board(second.id) });
      // Starring twice changes nothing.
      await stars.star({ projectId: PROJECT, userId: "a", star: board(third.id) });

      await expect(listed(stars, "a")).resolves.toEqual([first.id, third.id, second.id]);
    });

    /** @scenario "AC165 A star can point at a From LangWatch board" */
    it("round-trips a template star without checking it against a list", async () => {
      const { stars } = serviceWith();

      await stars.star({ projectId: PROJECT, userId: "a", star: template("llm-costs") });
      await stars.star({ projectId: PROJECT, userId: "a", star: template("llm-costs") });

      await expect(listed(stars, "a")).resolves.toEqual(["template:llm-costs"]);
    });

    /** @scenario "AC165 A star can point at a From LangWatch board" */
    it("lists boards and templates in the order they were starred", async () => {
      const { service, stars } = serviceWith();
      const created = await service.create({ projectId: PROJECT, name: "One" });

      await stars.star({ projectId: PROJECT, userId: "a", star: template("t1") });
      await stars.star({ projectId: PROJECT, userId: "a", star: board(created.id) });

      await expect(listed(stars, "a")).resolves.toEqual(["template:t1", created.id]);
    });

    /** @scenario "AC155 Move up and Move down reorder the member's stars" */
    it("unstars a board or a template and reorders both kinds", async () => {
      const { service, stars } = serviceWith();
      const a = await service.create({ projectId: PROJECT, name: "A" });
      const b = await service.create({ projectId: PROJECT, name: "B" });
      for (const star of [board(a.id), board(b.id), template("t1")]) {
        await stars.star({ projectId: PROJECT, userId: "u", star });
      }

      await stars.unstar({ projectId: PROJECT, userId: "u", star: board(b.id) });
      await expect(listed(stars, "u")).resolves.toEqual([a.id, "template:t1"]);

      await stars.reorderStars({
        projectId: PROJECT,
        userId: "u",
        stars: [template("t1"), board(a.id)],
      });
      await expect(listed(stars, "u")).resolves.toEqual(["template:t1", a.id]);

      await stars.unstar({ projectId: PROJECT, userId: "u", star: template("t1") });
      await expect(listed(stars, "u")).resolves.toEqual([a.id]);
    });

    /** @scenario "AC26 Deleting a board removes it from every member's stars" */
    it("removes the board from every member's stars when it is deleted", async () => {
      const { service, stars } = serviceWith();
      const created = await service.create({ projectId: PROJECT, name: "Shared" });
      await stars.star({ projectId: PROJECT, userId: "a", star: board(created.id) });
      await stars.star({ projectId: PROJECT, userId: "b", star: board(created.id) });

      await service.delete({ projectId: PROJECT, dashboardId: created.id });

      await expect(listed(stars, "a")).resolves.toEqual([]);
      await expect(listed(stars, "b")).resolves.toEqual([]);
    });

    it("refuses a star on a board the project does not have", async () => {
      const { stars } = serviceWith();

      await expect(
        stars.star({ projectId: PROJECT, userId: "a", star: board("missing") }),
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
