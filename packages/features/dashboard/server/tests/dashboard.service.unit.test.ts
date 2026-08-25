import type {
  Graph,
  SavedWorkbenchChartDefinition,
} from "@langwatch/dashboard-contract";
import { describe, expect, it, vi } from "vitest";
import {
  DashboardIdGenerator,
  DashboardRepository,
  SavedWorkbenchChartPolicy,
  type DashboardRecord,
  type DashboardSummaryRecord,
  type SavedWorkbenchChartRecord,
} from "../src/ports/dashboard.port";
import { DashboardService } from "../src/services/dashboard.service";

const dashboard: DashboardRecord = {
  id: "dashboard_1",
  projectId: "project_1",
  name: "Reports",
  order: 0,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const graph: Graph = {
  id: "graph_1",
  projectId: "project_1",
  name: "Latency",
  graph: { graphType: "line" },
  filters: {},
  dashboardId: "dashboard_1",
  gridColumn: 0,
  gridRow: 0,
  colSpan: 1,
  rowSpan: 1,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

class FakeDashboardRepository extends DashboardRepository {
  findAllDashboards = vi.fn<() => Promise<DashboardSummaryRecord[]>>().mockResolvedValue([{ ...dashboard, graphCount: 1 }]);
  tryFindDashboard = vi.fn<() => Promise<(DashboardRecord & { graphs: Graph[] }) | null>>().mockResolvedValue({ ...dashboard, graphs: [graph] });
  tryFindFirstDashboard = vi.fn<() => Promise<DashboardRecord | null>>().mockResolvedValue(dashboard);
  tryFindLastDashboard = vi.fn<() => Promise<DashboardRecord | null>>().mockResolvedValue(dashboard);
  findDashboardIds = vi.fn<() => Promise<string[]>>().mockResolvedValue(["dashboard_1"]);
  createDashboard = vi.fn<() => Promise<DashboardRecord>>().mockResolvedValue(dashboard);
  updateDashboard = vi.fn<() => Promise<DashboardRecord>>().mockResolvedValue(dashboard);
  deleteDashboard = vi.fn<() => Promise<DashboardRecord>>().mockResolvedValue(dashboard);
  updateDashboardOrder = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  findAllGraphs = vi.fn<() => Promise<Graph[]>>().mockResolvedValue([graph]);
  tryFindGraph = vi.fn<() => Promise<Graph | null>>().mockResolvedValue(graph);
  tryFindLastGraphGridRow = vi.fn<() => Promise<number | null>>().mockResolvedValue(2);
  createGraph = vi.fn<() => Promise<Graph>>().mockResolvedValue(graph);
  updateGraph = vi.fn<() => Promise<Graph>>().mockResolvedValue(graph);
  deleteGraph = vi.fn<() => Promise<Graph>>().mockResolvedValue(graph);
  updateGraphLayout = vi.fn<() => Promise<Graph>>().mockResolvedValue(graph);
  updateGraphLayouts = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  findAllSavedWorkbenchCharts = vi.fn<() => Promise<SavedWorkbenchChartRecord[]>>().mockResolvedValue([]);
  tryFindSavedWorkbenchChart = vi.fn<() => Promise<SavedWorkbenchChartRecord | null>>().mockResolvedValue(null);
  createSavedWorkbenchChart = vi.fn<() => Promise<SavedWorkbenchChartRecord>>();
  tryUpdateSavedWorkbenchChart = vi.fn<() => Promise<SavedWorkbenchChartRecord | null>>();
  deleteSavedWorkbenchChart = vi.fn<() => Promise<number>>();
}

class FakeSavedWorkbenchChartPolicy extends SavedWorkbenchChartPolicy {
  validate = vi.fn();
}

class FakeDashboardIds extends DashboardIdGenerator {
  generate(): string {
    return "generated_id";
  }
}

function serviceWith(repository = new FakeDashboardRepository()) {
  const policy = new FakeSavedWorkbenchChartPolicy();
  return {
    repository,
    policy,
    service: DashboardService.create({
      repository,
      ids: new FakeDashboardIds(),
      savedWorkbenchChartPolicy: policy,
    }),
  };
}

describe("DashboardService", () => {
  it("creates dashboards after the project's current last order", async () => {
    const { service, repository } = serviceWith();
    await service.create({ projectId: "project_1", name: "Quality" });
    expect(repository.createDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project_1", name: "Quality", order: 1 }),
    );
  });

  it("does not permit a dashboard from another project to be renamed", async () => {
    const repository = new FakeDashboardRepository();
    repository.tryFindDashboard.mockResolvedValue(null);
    await expect(
      serviceWith(repository).service.rename({ projectId: "project_1", dashboardId: "dashboard_2", name: "Nope" }),
    ).rejects.toThrow("Dashboard not found");
  });

  it("reports every dashboard missing from a reorder request", async () => {
    const repository = new FakeDashboardRepository();
    repository.findDashboardIds.mockResolvedValue(["dashboard_1"]);
    await expect(
      serviceWith(repository).service.reorder({ projectId: "project_1", dashboardIds: ["dashboard_1", "dashboard_2"] }),
    ).rejects.toMatchObject({ missingIds: ["dashboard_2"] });
    expect(repository.updateDashboardOrder).not.toHaveBeenCalled();
  });

  it("places a graph after every chart already occupying the dashboard grid", async () => {
    const { service, repository } = serviceWith();
    await service.createGraph({
      projectId: "project_1",
      name: "Errors",
      graph: { graphType: "line" },
      dashboardId: "dashboard_1",
    });
    expect(repository.createGraph).toHaveBeenCalledWith(
      expect.objectContaining({ layout: expect.objectContaining({ gridRow: 3 }) }),
    );
  });

  it("passes saved-chart definitions through the policy before persistence", async () => {
    const chart: SavedWorkbenchChartRecord = {
      id: "chart_1",
      projectId: "project_1",
      name: "Saved",
      definition: { version: 1, sql: "SELECT 1", parameters: {} },
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    };
    const repository = new FakeDashboardRepository();
    repository.createSavedWorkbenchChart.mockResolvedValue(chart);
    const { service, policy } = serviceWith(repository);
    const definition: SavedWorkbenchChartDefinition = {
      version: 1,
      sql: "SELECT 1",
      parameters: {},
    };
    await service.createSavedWorkbenchChart({ projectId: "project_1", name: "Saved", definition, id: "chart_1" });
    expect(policy.validate).toHaveBeenCalledWith({ projectId: "project_1", definition });
  });

  it("refuses a stored chart definition that no longer matches the versioned shape", async () => {
    const repository = new FakeDashboardRepository();
    repository.tryFindSavedWorkbenchChart.mockResolvedValue({
      id: "chart_1",
      projectId: "project_1",
      name: "Corrupt",
      definition: { version: 2, sql: "SELECT 1" },
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    });
    await expect(
      serviceWith(repository).service.getSavedWorkbenchChart({ projectId: "project_1", chartId: "chart_1" }),
    ).rejects.toThrow("Saved workbench chart definition is invalid");
  });
});
