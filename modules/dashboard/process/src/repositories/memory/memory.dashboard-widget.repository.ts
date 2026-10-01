import {
  DashboardWidgetDefinitionInvalidError,
  DashboardWidgetNotFoundError,
} from "@langwatch/analytics-contract";
import {
  CHART_GRID_DEFAULT_COL_SPAN,
  CHART_GRID_DEFAULT_ROW_SPAN,
  chartGridBottomRow,
} from "@langwatch/analytics-contract/chart-grid";
import {
  DASHBOARD_WIDGET_DEFINITION_VERSION,
  dashboardWidgetDefinitionSchema,
} from "@langwatch/analytics-contract/dashboard-widget-definition";
import { nowInstant } from "@langwatch/time";

import type {
  AssignDashboardWidgetInput,
  CreateDashboardWidgetInput,
  DashboardWidgetLayoutsInput,
  DashboardWidgetRepository,
  DashboardWidgetRow,
  DashboardWidgetScope,
  UpdateDashboardWidgetInput,
} from "../dashboard-widget.repository.ts";

/** In-memory parity for widget CRUD; dashboard ownership is enforced by the live transaction. */
export class MemoryDashboardWidgetRepository implements DashboardWidgetRepository {
  #rows: DashboardWidgetRow[] = [];

  private constructor() {}

  static create(): MemoryDashboardWidgetRepository {
    return new MemoryDashboardWidgetRepository();
  }

  async findAll(input: { projectId: string }): Promise<DashboardWidgetRow[]> {
    return this.#rows
      .filter((row) => row.projectId === input.projectId)
      .toSorted((left, right) => left.gridRow - right.gridRow || left.gridColumn - right.gridColumn)
      .map((row) => this.#copy(row));
  }

  async getById(input: DashboardWidgetScope): Promise<DashboardWidgetRow> {
    return this.#copy(this.#require(input));
  }

  async createWidget(input: CreateDashboardWidgetInput): Promise<DashboardWidgetRow> {
    const rows = this.#rows.filter(
      (row) =>
        row.projectId === input.projectId &&
        (input.dashboardId === undefined || row.dashboardId === input.dashboardId),
    );
    const row: DashboardWidgetRow = {
      id: input.id,
      projectId: input.projectId,
      name: input.input.name,
      graph: {
        version: DASHBOARD_WIDGET_DEFINITION_VERSION,
        code: input.input.code,
        queries: [...input.input.queries],
      },
      createdAt: nowInstant(),
      updatedAt: nowInstant(),
      dashboardId: input.dashboardId ?? null,
      gridColumn: 0,
      gridRow: chartGridBottomRow(rows),
      colSpan: CHART_GRID_DEFAULT_COL_SPAN,
      rowSpan: CHART_GRID_DEFAULT_ROW_SPAN,
    };
    this.#rows.push(row);

    return this.#copy(row);
  }

  async updateWidget(input: UpdateDashboardWidgetInput): Promise<DashboardWidgetRow> {
    const current = this.#require(input);
    const definition = dashboardWidgetDefinitionSchema.safeParse(current.graph);
    if (!definition.success) {
      throw new DashboardWidgetDefinitionInvalidError(current.id, { reasons: [definition.error] });
    }
    const updated: DashboardWidgetRow = {
      ...current,
      ...(input.input.name === undefined ? {} : { name: input.input.name }),
      graph: {
        version: DASHBOARD_WIDGET_DEFINITION_VERSION,
        code: input.input.code ?? definition.data.code,
        queries: input.input.queries ?? definition.data.queries,
      },
      updatedAt: nowInstant(),
    };
    this.#replace(updated);

    return this.#copy(updated);
  }

  async deleteWidget(input: DashboardWidgetScope): Promise<void> {
    const row = this.#require(input);
    this.#rows = this.#rows.filter((candidate) => candidate.id !== row.id);
  }

  async assignToDashboard(input: AssignDashboardWidgetInput): Promise<DashboardWidgetRow> {
    const current = this.#require(input);
    const onDashboard = this.#rows.filter(
      (row) => row.projectId === input.projectId && row.dashboardId === input.dashboardId,
    );
    const updated: DashboardWidgetRow = {
      ...current,
      dashboardId: input.dashboardId,
      gridColumn: 0,
      gridRow: chartGridBottomRow(onDashboard),
      updatedAt: nowInstant(),
    };
    this.#replace(updated);

    return this.#copy(updated);
  }

  async updateLayouts({ projectId, layouts }: DashboardWidgetLayoutsInput): Promise<void> {
    for (const { graphId, layout } of layouts) {
      const current = this.#rows.find((row) => row.id === graphId && row.projectId === projectId);
      if (current === undefined) continue;
      this.#replace({
        ...current,
        gridColumn: layout.gridColumn,
        gridRow: layout.gridRow,
        colSpan: layout.colSpan,
        rowSpan: layout.rowSpan,
        updatedAt: nowInstant(),
      });
    }
  }

  #require(input: DashboardWidgetScope): DashboardWidgetRow {
    const row = this.#rows.find(
      (candidate) => candidate.id === input.id && candidate.projectId === input.projectId,
    );
    if (!row) throw new DashboardWidgetNotFoundError();

    return row;
  }

  #replace(row: DashboardWidgetRow): void {
    this.#rows = this.#rows.map((candidate) => (candidate.id === row.id ? row : candidate));
  }

  #copy(row: DashboardWidgetRow): DashboardWidgetRow {
    return { ...row, graph: structuredClone(row.graph) };
  }
}
