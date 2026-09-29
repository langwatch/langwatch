import {
  DashboardWidgetDefinitionInvalidError,
  DashboardWidgetNotFoundError,
  type AnalyticsApi,
  type DashboardWidget,
} from "@langwatch/analytics-contract";
import { dashboardWidgetDefinitionSchema } from "@langwatch/analytics-contract/dashboard-widget-definition";
import {
  DASHBOARD_WIDGET_KSUID_RESOURCE,
  type DashboardViewer,
} from "@langwatch/dashboard-contract";
import { generate } from "@langwatch/ksuid";

import type { DashboardBoardAudience } from "#app/dashboard.members";
import type {
  DashboardWidgetRow,
  DashboardWidgetRepository,
  DashboardWidgetScope,
  CreateDashboardWidgetInput,
  UpdateDashboardWidgetInput,
  AssignDashboardWidgetInput,
  DashboardWidgetLayoutsInput,
} from "#repositories/dashboard-widget.repository";

type Viewed = Readonly<{ viewer?: DashboardViewer }>;

/**
 * Every widget operation first asks analytics whether the project may use the
 * playground. A widget on a board outside the viewer's audience reads and
 * writes as not found, exactly like a widget that does not exist.
 */
export class DashboardWidgetService {
  #repository: DashboardWidgetRepository;
  #analytics: AnalyticsApi;
  #boards: DashboardBoardAudience;

  private constructor(
    repository: DashboardWidgetRepository,
    analytics: AnalyticsApi,
    boards: DashboardBoardAudience,
  ) {
    this.#repository = repository;
    this.#analytics = analytics;
    this.#boards = boards;
  }

  static create(options: {
    repository: DashboardWidgetRepository;
    analytics: AnalyticsApi;
    boards: DashboardBoardAudience;
  }): DashboardWidgetService {
    return new DashboardWidgetService(options.repository, options.analytics, options.boards);
  }

  async getAll(input: { projectId: string } & Viewed): Promise<DashboardWidget[]> {
    await this.#assertEnabled(input);
    const rows = await this.#visibleRows(input);
    return rows.map((row) => this.#present(row));
  }

  async getById(input: DashboardWidgetScope & Viewed): Promise<DashboardWidget> {
    await this.#assertEnabled(input);
    return this.#present(await this.#visibleRow(input));
  }

  async createWidget(
    input: Omit<CreateDashboardWidgetInput, "id"> & Viewed,
  ): Promise<DashboardWidget> {
    const { viewer, ...fields } = input;
    await this.#assertEnabled(fields);
    if (fields.dashboardId !== undefined) {
      await this.#assertBoardVisible({ ...fields, dashboardId: fields.dashboardId, viewer });
    }
    return this.#present(
      await this.#repository.createWidget({
        ...fields,
        id: generate(DASHBOARD_WIDGET_KSUID_RESOURCE).toString(),
      }),
    );
  }

  async updateWidget(input: UpdateDashboardWidgetInput & Viewed): Promise<DashboardWidget> {
    const { viewer: _viewer, ...fields } = input;
    await this.#assertEnabled(fields);
    await this.#visibleRow(input);
    return this.#present(await this.#repository.updateWidget(fields));
  }

  async assignToDashboard(input: AssignDashboardWidgetInput & Viewed): Promise<DashboardWidget> {
    const { viewer: _viewer, ...fields } = input;
    await this.#assertEnabled(fields);
    await this.#visibleRow(input);
    await this.#assertBoardVisible(input);
    return this.#present(await this.#repository.assignToDashboard(fields));
  }

  async deleteWidget(input: DashboardWidgetScope & Viewed): Promise<void> {
    await this.#assertEnabled(input);
    await this.#visibleRow(input);
    return this.#repository.deleteWidget({ projectId: input.projectId, id: input.id });
  }

  /** A layout for a widget on a board outside the audience is skipped, like an unknown id. */
  async updateLayouts(input: DashboardWidgetLayoutsInput & Viewed): Promise<void> {
    await this.#assertEnabled(input);
    const [rows, visible] = await Promise.all([
      this.#repository.findAll({ projectId: input.projectId }),
      this.#visibleIds(input),
    ]);
    const hidden = new Set(
      rows.filter((row) => !isOnVisibleBoard(row, visible)).map((row) => row.id),
    );
    await this.#repository.updateLayouts({
      projectId: input.projectId,
      layouts: input.layouts.filter((layout) => !hidden.has(layout.graphId)),
    });
  }

  async #visibleRows(input: { projectId: string } & Viewed): Promise<DashboardWidgetRow[]> {
    const [rows, visible] = await Promise.all([
      this.#repository.findAll({ projectId: input.projectId }),
      this.#visibleIds(input),
    ]);
    return rows.filter((row) => isOnVisibleBoard(row, visible));
  }

  async #visibleRow(input: DashboardWidgetScope & Viewed): Promise<DashboardWidgetRow> {
    const row = await this.#repository.getById({ projectId: input.projectId, id: input.id });
    if (row.dashboardId !== null) {
      await this.#assertBoardVisible({ ...input, dashboardId: row.dashboardId });
    }
    return row;
  }

  async #assertBoardVisible(input: {
    projectId: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<void> {
    const visible = await this.#boards.isVisibleTo({
      projectId: input.projectId,
      dashboardId: input.dashboardId,
      viewer: input.viewer,
    });
    if (!visible) throw new DashboardWidgetNotFoundError();
  }

  async #visibleIds(input: { projectId: string } & Viewed): Promise<ReadonlySet<string>> {
    return new Set(
      await this.#boards.findVisibleDashboardIds({
        projectId: input.projectId,
        viewer: input.viewer,
      }),
    );
  }

  #assertEnabled({ projectId }: { projectId: string }): Promise<void> {
    return this.#analytics.assertCustomChartPlaygroundEnabled({ projectId });
  }

  #present(row: DashboardWidgetRow): DashboardWidget {
    const parsed = dashboardWidgetDefinitionSchema.safeParse(row.graph);
    if (!parsed.success) {
      throw new DashboardWidgetDefinitionInvalidError(row.id, { reasons: [parsed.error] });
    }
    const { graph: _graph, ...widget } = row;
    return { ...widget, definition: parsed.data };
  }
}

/** An unplaced widget belongs to no board, so no audience narrows it. */
function isOnVisibleBoard(row: DashboardWidgetRow, visible: ReadonlySet<string>): boolean {
  return row.dashboardId === null || visible.has(row.dashboardId);
}
