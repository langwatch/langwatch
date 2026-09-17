import { DashboardWidgetDefinitionInvalidError } from "@langwatch/analytics-contract";
import { dashboardWidgetDefinitionSchema } from "@langwatch/analytics-contract/dashboard-widget-definition";
import type {
  DashboardWidget, DashboardWidgetRow, DashboardWidgetRepository,
  DashboardWidgetScope, CreateDashboardWidgetInput, UpdateDashboardWidgetInput, AssignDashboardWidgetInput,
} from "../repositories/dashboard-widget.repository.ts";

export class DashboardWidgetService {
  #repository: DashboardWidgetRepository;

  private constructor(repository: DashboardWidgetRepository) {
    this.#repository = repository;
  }

  static create(repository: DashboardWidgetRepository): DashboardWidgetService {
    return new DashboardWidgetService(repository);
  }

  async getAll(input: { projectId: string }): Promise<DashboardWidget[]> {
    const rows = await this.#repository.findAll(input);
    return rows.map((row) => this.#present(row));
  }

  async getById(input: DashboardWidgetScope): Promise<DashboardWidget> {
    return this.#present(await this.#repository.getById(input));
  }

  async createWidget(input: CreateDashboardWidgetInput): Promise<DashboardWidget> {
    return this.#present(await this.#repository.createWidget(input));
  }

  async updateWidget(input: UpdateDashboardWidgetInput): Promise<DashboardWidget> {
    return this.#present(await this.#repository.updateWidget(input));
  }

  async assignToDashboard(input: AssignDashboardWidgetInput): Promise<DashboardWidget> {
    return this.#present(await this.#repository.assignToDashboard(input));
  }

  deleteWidget(input: DashboardWidgetScope): Promise<void> {
    return this.#repository.deleteWidget(input);
  }

  #present(row: DashboardWidgetRow): DashboardWidget {
    const parsed = dashboardWidgetDefinitionSchema.safeParse(row.graph);
    if (!parsed.success) {
      throw new DashboardWidgetDefinitionInvalidError(row.id, { reasons: [parsed.error] });
    }
    const { graph, ...widget } = row;
    return { ...widget, definition: parsed.data };
  }
}
