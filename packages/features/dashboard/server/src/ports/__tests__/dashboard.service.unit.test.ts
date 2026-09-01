import type {
  LangWatchQLExecuteInput,
  LangWatchQLQueryResult,
  LangWatchQLSchema,
  LangWatchQLValidationInput,
} from "@langwatch/analytics-contract";
import { LangWatchQLService } from "@langwatch/analytics-contract";
import {
  SavedWorkbenchChartNotFoundError,
  SavedWorkbenchChartValidationError,
  type Graph,
  type SavedWorkbenchChartDefinition,
} from "@langwatch/dashboard-contract";
import { describe, expect, it, vi } from "vitest";
import {
  DashboardIdGenerator,
  DashboardGraphVisibilityPolicyPort,
  DashboardRepository,
  SavedWorkbenchChartPolicy,
  type DashboardRecord,
  type DashboardSummaryRecord,
  type SavedWorkbenchChartRecord,
} from "../dashboard.port";
import { DashboardService } from "../../services/dashboard.service";

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
  findAllDashboards = vi
    .fn<() => Promise<DashboardSummaryRecord[]>>()
    .mockResolvedValue([{ ...dashboard, graphCount: 1 }]);
  tryFindDashboard = vi
    .fn<() => Promise<(DashboardRecord & { graphs: Graph[] }) | null>>()
    .mockResolvedValue({ ...dashboard, graphs: [graph] });
  tryFindFirstDashboard = vi
    .fn<() => Promise<DashboardRecord | null>>()
    .mockResolvedValue(dashboard);
  tryFindLastDashboard = vi
    .fn<() => Promise<DashboardRecord | null>>()
    .mockResolvedValue(dashboard);
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
  findAllSavedWorkbenchCharts = vi
    .fn<() => Promise<SavedWorkbenchChartRecord[]>>()
    .mockResolvedValue([]);
  tryFindSavedWorkbenchChart = vi
    .fn<() => Promise<SavedWorkbenchChartRecord | null>>()
    .mockResolvedValue(null);
  createSavedWorkbenchChart = vi.fn<() => Promise<SavedWorkbenchChartRecord>>();
  tryUpdateSavedWorkbenchChart = vi.fn<() => Promise<SavedWorkbenchChartRecord | null>>();
  deleteSavedWorkbenchChart = vi.fn<() => Promise<number>>();
  tryPlaceSavedWorkbenchChart = vi.fn<() => Promise<SavedWorkbenchChartRecord | null>>();
  tryUnplaceSavedWorkbenchChart = vi.fn<() => Promise<SavedWorkbenchChartRecord | null>>();
}

class FakeSavedWorkbenchChartPolicy extends SavedWorkbenchChartPolicy {
  validate = vi.fn();
}

class FakeDashboardIds extends DashboardIdGenerator {
  generate(): string {
    return "generated_id";
  }
}

class FakeDashboardGraphVisibility extends DashboardGraphVisibilityPolicyPort {
  placeableKinds = vi
    .fn<() => Promise<readonly ("builder" | "workbench_sql")[]>>()
    .mockResolvedValue(["builder", "workbench_sql"]);
}

class FakeLangWatchQL extends LangWatchQLService {
  readonly available = true;
  close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  validate = vi.fn<(input: LangWatchQLValidationInput) => unknown>();
  execute = vi
    .fn<(input: LangWatchQLExecuteInput) => Promise<LangWatchQLQueryResult>>()
    .mockResolvedValue({
      columns: [],
      rows: [],
      statistics: { elapsedMs: 0, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
      truncated: false,
      diagnostics: [],
      followsTimeWindow: false,
      followsGranularity: false,
    });

  describeSchema(_input: {
    protections: LangWatchQLValidationInput["protections"];
  }): LangWatchQLSchema {
    return { database: "analytics", datasets: [] };
  }
}

function serviceWith(repository = new FakeDashboardRepository()) {
  const policy = new FakeSavedWorkbenchChartPolicy();
  const graphVisibility = new FakeDashboardGraphVisibility();
  const langWatchQL = new FakeLangWatchQL();
  return {
    repository,
    policy,
    graphVisibility,
    langWatchQL,
    service: DashboardService.create({
      repository,
      ids: new FakeDashboardIds(),
      savedWorkbenchChartPolicy: policy,
      graphVisibility,
      langWatchQL,
    }),
  };
}

describe("DashboardService", () => {
  const savedChart: SavedWorkbenchChartRecord = {
    id: "chart_1",
    projectId: "project_1",
    name: "Saved",
    definition: { version: 1, sql: "SELECT 1", parameters: { segment: "paid" } },
    dashboardId: null,
    gridColumn: 0,
    gridRow: 0,
    colSpan: 1,
    rowSpan: 1,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };

  /** @scenario "The dashboard list counts exactly the cards the grid will render" */
  it("counts the graph kinds placeable for the project", async () => {
    const { service, repository, graphVisibility } = serviceWith();
    await service.getAll({ projectId: "project_1", graphCountScope: "placeable" });
    expect(graphVisibility.placeableKinds).toHaveBeenCalledWith({ projectId: "project_1" });
    expect(repository.findAllDashboards).toHaveBeenCalledWith({
      projectId: "project_1",
      graphKinds: ["builder", "workbench_sql"],
    });
  });

  /** @scenario "The dashboard list counts exactly the cards the grid will render" */
  it("counts only builder graphs for a list whose detail returns only builders", async () => {
    const { service, repository, graphVisibility } = serviceWith();
    await service.getAll({ projectId: "project_1", graphCountScope: "builder" });
    expect(graphVisibility.placeableKinds).not.toHaveBeenCalled();
    expect(repository.findAllDashboards).toHaveBeenCalledWith({
      projectId: "project_1",
      graphKinds: ["builder"],
    });
  });

  /** @scenario "A dashboard is created after the project's current dashboards" */
  it("creates dashboards after the project's current last order", async () => {
    const { service, repository } = serviceWith();
    await service.create({ projectId: "project_1", name: "Quality" });
    expect(repository.createDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project_1", name: "Quality", order: 1 }),
    );
  });

  /** @scenario "A dashboard from another project cannot be renamed" */
  it("does not permit a dashboard from another project to be renamed", async () => {
    const repository = new FakeDashboardRepository();
    repository.tryFindDashboard.mockResolvedValue(null);
    await expect(
      serviceWith(repository).service.rename({
        projectId: "project_1",
        dashboardId: "dashboard_2",
        name: "Nope",
      }),
    ).rejects.toThrow("Dashboard not found");
  });

  it("reports every dashboard missing from a reorder request", async () => {
    const repository = new FakeDashboardRepository();
    repository.findDashboardIds.mockResolvedValue(["dashboard_1"]);
    await expect(
      serviceWith(repository).service.reorder({
        projectId: "project_1",
        dashboardIds: ["dashboard_1", "dashboard_2"],
      }),
    ).rejects.toMatchObject({ missingIds: ["dashboard_2"] });
    expect(repository.updateDashboardOrder).not.toHaveBeenCalled();
  });

  /** @scenario "A graph is placed after every chart in the shared grid" */
  it("places a builder graph after a workbench chart already occupying the dashboard grid", async () => {
    const { service, repository } = serviceWith();
    repository.tryFindLastGraphGridRow.mockResolvedValue(5);
    await service.createGraph({
      projectId: "project_1",
      name: "Errors",
      graph: { graphType: "line" },
      dashboardId: "dashboard_1",
    });
    expect(repository.createGraph).toHaveBeenCalledWith(
      expect.objectContaining({ layout: expect.objectContaining({ gridRow: 6 }) }),
    );
  });

  /** @scenario "Saved chart governance is called before persistence" */
  it("passes saved-chart definitions through the policy before persistence", async () => {
    const repository = new FakeDashboardRepository();
    repository.createSavedWorkbenchChart.mockResolvedValue(savedChart);
    const { service, policy } = serviceWith(repository);
    const definition: SavedWorkbenchChartDefinition = {
      version: 1,
      sql: "SELECT 1",
      parameters: {},
    };
    await service.createSavedWorkbenchChart({
      projectId: "project_1",
      protections: { canSeeCosts: true },
      name: "Saved",
      definition,
      id: "chart_1",
    });
    expect(policy.validate).toHaveBeenCalledWith({
      projectId: "project_1",
      protections: { canSeeCosts: true },
      definition,
    });
  });

  /** @scenario "A specification the chart policy refuses never reaches the database" */
  /** @scenario "SQL the LangWatchQL validator refuses never reaches the database" */
  it("does not persist a saved chart when its caller-specific admission policy refuses it", async () => {
    const { service, policy, repository } = serviceWith();
    policy.validate.mockImplementation(() => {
      throw new Error("LWQL not permitted");
    });
    await expect(
      service.createSavedWorkbenchChart({
        projectId: "project_1",
        protections: { canSeeCapturedInput: false },
        name: "Saved",
        definition: { version: 1, sql: "SELECT CapturedInput", parameters: {} },
      }),
    ).rejects.toThrow("LWQL not permitted");
    expect(repository.createSavedWorkbenchChart).not.toHaveBeenCalled();
  });

  it("returns a handled validation error for malformed saved-chart writes", async () => {
    const { service, repository } = serviceWith();

    await expect(
      service.createSavedWorkbenchChart({
        projectId: "project_1",
        protections: {},
        name: " ",
        definition: { version: 1, sql: "SELECT 1" },
      }),
    ).rejects.toBeInstanceOf(SavedWorkbenchChartValidationError);
    await expect(
      service.createSavedWorkbenchChart({
        projectId: "project_1",
        protections: {},
        name: "Saved",
        definition: { sql: "SELECT 1" },
      }),
    ).rejects.toBeInstanceOf(SavedWorkbenchChartValidationError);
    await expect(
      service.createSavedWorkbenchChart({
        projectId: "project_1",
        protections: {},
        name: "Saved",
        definition: { version: 1, sql: "SELECT 1" },
        id: "x".repeat(65),
      }),
    ).rejects.toBeInstanceOf(SavedWorkbenchChartValidationError);
    await expect(
      service.placeSavedWorkbenchChart({
        projectId: "project_1",
        chartId: "chart_1",
        dashboardId: "dashboard_1",
        gridColumn: 1,
        colSpan: 2,
      }),
    ).rejects.toBeInstanceOf(SavedWorkbenchChartValidationError);

    expect(repository.createSavedWorkbenchChart).not.toHaveBeenCalled();
    expect(repository.tryFindDashboard).not.toHaveBeenCalled();
  });

  it("maps an oversized saved-chart lookup id to the canonical not-found error", async () => {
    const { service, repository } = serviceWith();
    const chartId = "x".repeat(65);

    await expect(
      service.getSavedWorkbenchChart({ projectId: "project_1", chartId }),
    ).rejects.toBeInstanceOf(SavedWorkbenchChartNotFoundError);
    expect(repository.tryFindSavedWorkbenchChart).toHaveBeenCalledWith({
      projectId: "project_1",
      chartId,
    });
  });

  it("checks the dashboard's project before placing a saved workbench chart", async () => {
    const repository = new FakeDashboardRepository();
    repository.tryFindDashboard.mockResolvedValue(null);
    await expect(
      serviceWith(repository).service.placeSavedWorkbenchChart({
        projectId: "project_1",
        chartId: "chart_1",
        dashboardId: "dashboard_other_project",
      }),
    ).rejects.toThrow("Dashboard not found");
    expect(repository.tryPlaceSavedWorkbenchChart).not.toHaveBeenCalled();
    expect(repository.tryFindLastGraphGridRow).not.toHaveBeenCalled();
  });

  it("places a workbench chart after a builder graph when no row is supplied", async () => {
    const repository = new FakeDashboardRepository();
    repository.tryFindLastGraphGridRow.mockResolvedValue(7);
    repository.tryPlaceSavedWorkbenchChart.mockResolvedValue({
      ...savedChart,
      dashboardId: "dashboard_1",
      gridRow: 8,
    });
    const { service } = serviceWith(repository);
    await service.placeSavedWorkbenchChart({
      projectId: "project_1",
      chartId: "chart_1",
      dashboardId: "dashboard_1",
    });
    expect(repository.tryFindLastGraphGridRow).toHaveBeenCalledWith({
      projectId: "project_1",
      dashboardId: "dashboard_1",
    });
    expect(repository.tryPlaceSavedWorkbenchChart).toHaveBeenCalledWith({
      projectId: "project_1",
      chartId: "chart_1",
      dashboardId: "dashboard_1",
      gridColumn: 0,
      gridRow: 8,
      colSpan: 1,
      rowSpan: 1,
    });
  });

  it("refuses an out-of-bounds placement before any persistence write", async () => {
    const { service, repository } = serviceWith();
    await expect(
      service.placeSavedWorkbenchChart({
        projectId: "project_1",
        chartId: "chart_1",
        dashboardId: "dashboard_1",
        gridColumn: 1,
        colSpan: 2,
      }),
    ).rejects.toThrow("gridColumn + colSpan must not exceed the 2-column grid");
    expect(repository.tryFindDashboard).not.toHaveBeenCalled();
    expect(repository.tryPlaceSavedWorkbenchChart).not.toHaveBeenCalled();
  });

  it("unplaces through the canonical repository operation", async () => {
    const repository = new FakeDashboardRepository();
    repository.tryUnplaceSavedWorkbenchChart.mockResolvedValue(savedChart);
    await serviceWith(repository).service.unplaceSavedWorkbenchChart({
      projectId: "project_1",
      chartId: "chart_1",
    });
    expect(repository.tryUnplaceSavedWorkbenchChart).toHaveBeenCalledWith({
      projectId: "project_1",
      chartId: "chart_1",
    });
  });

  it("runs a saved chart through Analytics with the requesting viewer's capability", async () => {
    const repository = new FakeDashboardRepository();
    repository.tryFindSavedWorkbenchChart.mockResolvedValue(savedChart);
    const { service, langWatchQL } = serviceWith(repository);
    await service.runSavedWorkbenchChart({
      projectId: "project_1",
      chartId: "chart_1",
      execution: {
        project: { id: "project_1", lwqlKey: "secret" },
        protections: { canSeeCosts: false },
        onBudgetOverflow: "coarsen",
      },
    });
    expect(langWatchQL.execute).toHaveBeenCalledWith({
      project: { id: "project_1", lwqlKey: "secret" },
      protections: { canSeeCosts: false },
      onBudgetOverflow: "coarsen",
      sql: "SELECT 1",
      parameters: { segment: "paid" },
    });
  });

  /** @scenario "A stored definition that no longer matches the schema is named, not returned as data" */
  it("refuses a stored chart definition that no longer matches the versioned shape", async () => {
    const repository = new FakeDashboardRepository();
    repository.tryFindSavedWorkbenchChart.mockResolvedValue({
      id: "chart_1",
      projectId: "project_1",
      name: "Corrupt",
      definition: { version: 2, sql: "SELECT 1" },
      dashboardId: null,
      gridColumn: 0,
      gridRow: 0,
      colSpan: 1,
      rowSpan: 1,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    });
    await expect(
      serviceWith(repository).service.getSavedWorkbenchChart({
        projectId: "project_1",
        chartId: "chart_1",
      }),
    ).rejects.toThrow("Saved workbench chart definition is invalid");
  });
});
