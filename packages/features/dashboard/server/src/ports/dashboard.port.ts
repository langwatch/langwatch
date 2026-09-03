import type { LangWatchQLProtections } from "@langwatch/analytics-contract";
import type {
  Graph,
  GraphLayout,
  SavedWorkbenchChartDefinition,
} from "@langwatch/dashboard-contract";

export type DashboardGraphKind = "builder" | "workbench_sql";

export type DashboardRecord = {
  id: string;
  projectId: string;
  name: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
};

export type DashboardSummaryRecord = DashboardRecord & { graphCount: number };
export type GraphRecord = Graph;

export type SavedWorkbenchChartRecord = {
  id: string;
  projectId: string;
  name: string;
  definition: unknown;
  dashboardId: string | null;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * A JSON value as a saved view stores it.
 *
 * Named here rather than taken from Prisma so the service and its callers can
 * describe a view's filters without importing the generated client — which is
 * what `prisma-containment` asks for, and what keeps the storage engine a
 * detail of the repository.
 */
export type SavedViewJson =
  | string
  | number
  | boolean
  | null
  | SavedViewJson[]
  // Members are optional to match how a JSON object arrives from storage.
  | { [key: string]: SavedViewJson | undefined };

/** A saved view as the repository hands it back. */
export type SavedViewRecord = {
  id: string;
  projectId: string;
  userId: string | null;
  name: string;
  filters: SavedViewJson;
  query: string | null;
  period: SavedViewJson | null;
  order: number;
  kind: string;
  createdAt: Date;
  updatedAt: Date;
};

/** The one private persistence capability owned by Dashboard. */
export abstract class DashboardRepository {
  abstract findAllDashboards(input: {
    projectId: string;
    graphKinds: readonly DashboardGraphKind[];
  }): Promise<DashboardSummaryRecord[]>;
  abstract tryFindDashboard(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<(DashboardRecord & { graphs: GraphRecord[] }) | null>;
  abstract tryFindFirstDashboard(input: { projectId: string }): Promise<DashboardRecord | null>;
  abstract tryFindLastDashboard(input: { projectId: string }): Promise<DashboardRecord | null>;
  abstract findDashboardIds(input: {
    projectId: string;
    dashboardIds: string[];
  }): Promise<string[]>;
  abstract createDashboard(input: {
    id: string;
    projectId: string;
    name: string;
    order: number;
  }): Promise<DashboardRecord>;
  abstract updateDashboard(input: {
    projectId: string;
    dashboardId: string;
    data: { name: string };
  }): Promise<DashboardRecord>;
  abstract deleteDashboard(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<DashboardRecord>;
  abstract updateDashboardOrder(input: {
    projectId: string;
    dashboardIds: string[];
  }): Promise<void>;

  abstract findAllGraphs(input: {
    projectId: string;
    dashboardId?: string;
  }): Promise<GraphRecord[]>;
  abstract tryFindGraph(input: { projectId: string; graphId: string }): Promise<GraphRecord | null>;
  abstract tryFindLastGraphGridRow(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<number | null>;
  abstract createGraph(input: {
    id: string;
    projectId: string;
    name: string;
    graph: Record<string, unknown>;
    filters: Record<string, unknown>;
    dashboardId: string | null;
    layout: GraphLayout;
  }): Promise<GraphRecord>;
  abstract updateGraph(input: {
    projectId: string;
    graphId: string;
    name?: string;
    graph?: Record<string, unknown>;
    filters?: Record<string, unknown>;
  }): Promise<GraphRecord>;
  abstract deleteGraph(input: { projectId: string; graphId: string }): Promise<GraphRecord>;
  abstract updateGraphLayout(input: {
    projectId: string;
    graphId: string;
    layout: GraphLayout;
  }): Promise<GraphRecord>;
  abstract updateGraphLayouts(input: {
    projectId: string;
    layouts: Array<{ graphId: string; layout: GraphLayout }>;
  }): Promise<void>;

  abstract findAllSavedWorkbenchCharts(input: {
    projectId: string;
  }): Promise<SavedWorkbenchChartRecord[]>;
  abstract tryFindSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChartRecord | null>;
  abstract createSavedWorkbenchChart(input: {
    id: string;
    projectId: string;
    name: string;
    definition: SavedWorkbenchChartDefinition;
  }): Promise<SavedWorkbenchChartRecord>;
  abstract tryUpdateSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    name?: string;
    definition?: SavedWorkbenchChartDefinition;
  }): Promise<SavedWorkbenchChartRecord | null>;
  abstract deleteSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<number>;
  abstract tryPlaceSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    dashboardId: string;
    gridColumn: number;
    gridRow: number;
    colSpan: number;
    rowSpan: number;
  }): Promise<SavedWorkbenchChartRecord | null>;
  abstract tryUnplaceSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChartRecord | null>;
}

/** Application-owned validation for LWQL and Vega-Lite definitions. */
export abstract class SavedWorkbenchChartPolicy {
  abstract validate(input: {
    projectId: string;
    protections: LangWatchQLProtections;
    definition: SavedWorkbenchChartDefinition;
  }): void | Promise<void>;
}

/** Controls which graph kinds a project may count as visible dashboard cards. */
export abstract class DashboardGraphVisibilityPolicyPort {
  abstract placeableKinds(input: { projectId: string }): Promise<readonly DashboardGraphKind[]>;
}

export abstract class DashboardIdGenerator {
  abstract generate(): string;
}
