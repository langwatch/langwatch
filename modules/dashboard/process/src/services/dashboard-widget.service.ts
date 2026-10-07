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

/** Whether a board the project may place a widget on exists. */
export interface DashboardBoardExistence {
  boardExists(input: { projectId: string; dashboardId: string }): Promise<boolean>;
}

/**
 * Every widget operation first asks analytics whether the project may use the
 * playground. A widget placed on a board the project does not hold reads and
 * writes as not found, exactly like a widget that does not exist.
 */
export class DashboardWidgetService {
  #repository: DashboardWidgetRepository;
  #analytics: AnalyticsApi;
  #boards: DashboardBoardExistence;

  private constructor(
    repository: DashboardWidgetRepository,
    analytics: AnalyticsApi,
    boards: DashboardBoardExistence,
  ) {
    this.#repository = repository;
    this.#analytics = analytics;
    this.#boards = boards;
  }

  static create(options: {
    repository: DashboardWidgetRepository;
    analytics: AnalyticsApi;
    boards: DashboardBoardExistence;
  }): DashboardWidgetService {
    return new DashboardWidgetService(options.repository, options.analytics, options.boards);
  }

  async getAll(input: { projectId: string } & Viewed): Promise<DashboardWidget[]> {
    await this.#assertEnabled(input);
    const rows = await this.#repository.findAll({ projectId: input.projectId });
    return rows.map((row) => this.#present(row));
  }

  async getById(input: DashboardWidgetScope & Viewed): Promise<DashboardWidget> {
    await this.#assertEnabled(input);
    return this.#present(
      await this.#repository.getById({ projectId: input.projectId, id: input.id }),
    );
  }

  async createWidget(
    input: Omit<CreateDashboardWidgetInput, "id"> & Viewed,
  ): Promise<DashboardWidget> {
    const { viewer: _viewer, ...fields } = input;
    await this.#assertEnabled(fields);
    if (fields.dashboardId !== undefined) {
      await this.#assertBoardExists({ ...fields, dashboardId: fields.dashboardId });
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
    await this.#repository.getById({ projectId: input.projectId, id: input.id });
    return this.#present(await this.#repository.updateWidget(fields));
  }

  async assignToDashboard(input: AssignDashboardWidgetInput & Viewed): Promise<DashboardWidget> {
    const { viewer: _viewer, ...fields } = input;
    await this.#assertEnabled(fields);
    await this.#repository.getById({ projectId: input.projectId, id: input.id });
    await this.#assertBoardExists(input);
    return this.#present(await this.#repository.assignToDashboard(fields));
  }

  async deleteWidget(input: DashboardWidgetScope & Viewed): Promise<void> {
    await this.#assertEnabled(input);
    await this.#repository.getById({ projectId: input.projectId, id: input.id });
    return this.#repository.deleteWidget({ projectId: input.projectId, id: input.id });
  }

  async updateLayouts(input: DashboardWidgetLayoutsInput & Viewed): Promise<void> {
    await this.#assertEnabled(input);
    await this.#repository.updateLayouts({
      projectId: input.projectId,
      layouts: input.layouts,
    });
  }

  async #assertBoardExists(input: { projectId: string; dashboardId: string }): Promise<void> {
    const exists = await this.#boards.boardExists({
      projectId: input.projectId,
      dashboardId: input.dashboardId,
    });
    if (!exists) throw new DashboardWidgetNotFoundError();
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
