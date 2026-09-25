import {
  DashboardWidgetDefinitionInvalidError,
  type AnalyticsApi,
  type DashboardWidget,
} from "@langwatch/analytics-contract";
import { dashboardWidgetDefinitionSchema } from "@langwatch/analytics-contract/dashboard-widget-definition";
import { DASHBOARD_WIDGET_KSUID_RESOURCE } from "@langwatch/dashboard-contract";
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

/** Every widget operation first asks analytics whether the project may use the playground. */
export class DashboardWidgetService {
  #repository: DashboardWidgetRepository;
  #analytics: AnalyticsApi;

  private constructor(repository: DashboardWidgetRepository, analytics: AnalyticsApi) {
    this.#repository = repository;
    this.#analytics = analytics;
  }

  static create(options: {
    repository: DashboardWidgetRepository;
    analytics: AnalyticsApi;
  }): DashboardWidgetService {
    return new DashboardWidgetService(options.repository, options.analytics);
  }

  async getAll(input: { projectId: string }): Promise<DashboardWidget[]> {
    await this.#assertEnabled(input);
    const rows = await this.#repository.findAll(input);
    return rows.map((row) => this.#present(row));
  }

  async getById(input: DashboardWidgetScope): Promise<DashboardWidget> {
    await this.#assertEnabled(input);
    return this.#present(await this.#repository.getById(input));
  }

  async createWidget(input: Omit<CreateDashboardWidgetInput, "id">): Promise<DashboardWidget> {
    await this.#assertEnabled(input);
    return this.#present(
      await this.#repository.createWidget({
        ...input,
        id: generate(DASHBOARD_WIDGET_KSUID_RESOURCE).toString(),
      }),
    );
  }

  async updateWidget(input: UpdateDashboardWidgetInput): Promise<DashboardWidget> {
    await this.#assertEnabled(input);
    return this.#present(await this.#repository.updateWidget(input));
  }

  async assignToDashboard(input: AssignDashboardWidgetInput): Promise<DashboardWidget> {
    await this.#assertEnabled(input);
    return this.#present(await this.#repository.assignToDashboard(input));
  }

  async deleteWidget(input: DashboardWidgetScope): Promise<void> {
    await this.#assertEnabled(input);
    return this.#repository.deleteWidget(input);
  }

  async updateLayouts(input: DashboardWidgetLayoutsInput): Promise<void> {
    await this.#assertEnabled(input);
    await this.#repository.updateLayouts(input);
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
