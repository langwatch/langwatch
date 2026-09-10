/**
 * The project's dashboards and the graphs placed on them, over the memory
 * repository the Prisma one is the twin of.
 *
 * Spec: modules/dashboard/specs/dashboard-service.feature.
 */
import {
  DashboardNotFoundError,
  DashboardReorderUnknownIdsError,
  GraphNotFoundError,
} from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import { WorkbenchAccess } from "../../app/dashboard.infrastructure.ts";
import { MemoryDashboardRepository } from "../../repositories/memory/memory.dashboard.repository.ts";
import { DashboardService } from "../dashboard.service.ts";

class FixedWorkbenchAccess implements WorkbenchAccess {
  constructor(private readonly enabled: boolean) {
  }

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
});
