import {
  DashboardWidgetDefinitionInvalidError,
  DashboardWidgetNotFoundError,
  type AnalyticsApi,
  type DashboardWidget,
} from "@langwatch/analytics-contract";
import {
  DASHBOARD_WIDGET_DEFINITION_VERSION,
  dashboardWidgetDefinitionSchema,
} from "@langwatch/analytics-contract/dashboard-widget-definition";
import {
  DASHBOARD_WIDGET_KSUID_RESOURCE,
  DashboardNotFoundError,
  DashboardReadOnlyHereError,
  DashboardWidgetDefinitionRefusedError,
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

import type { DashboardAccessService } from "./dashboard-access.service.ts";

type Viewed = Readonly<{ viewer?: DashboardViewer }>;

/** An update's code and queries, each optional; the repository merges them into the stored half. */
const definitionUpdateSchema = dashboardWidgetDefinitionSchema.partial();

/**
 * Every widget operation first asks analytics whether the project may use the playground. A
 * widget on a board the viewer may not see reads and writes as not found, exactly like one that
 * does not exist; an Organization board's widgets are read, never written, from other projects.
 */
export class DashboardWidgetService {
  #repository: DashboardWidgetRepository;
  #analytics: AnalyticsApi;
  #boards: DashboardAccessService;

  private constructor(
    repository: DashboardWidgetRepository,
    analytics: AnalyticsApi,
    boards: DashboardAccessService,
  ) {
    this.#repository = repository;
    this.#analytics = analytics;
    this.#boards = boards;
  }

  static create(options: {
    repository: DashboardWidgetRepository;
    analytics: AnalyticsApi;
    boards: DashboardAccessService;
  }): DashboardWidgetService {
    return new DashboardWidgetService(options.repository, options.analytics, options.boards);
  }

  /** The project's widgets the viewer may see, or with `dashboardId` one readable board's. */
  async getAll(
    input: { projectId: string; dashboardId?: string } & Viewed,
  ): Promise<DashboardWidget[]> {
    await this.#assertEnabled(input);
    const rows =
      input.dashboardId === undefined
        ? await this.#visibleRows(input)
        : await this.#boardRows({ ...input, dashboardId: input.dashboardId });
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
      await this.#assertBoardWritable({ ...fields, dashboardId: fields.dashboardId, viewer });
    }
    const id = generate(DASHBOARD_WIDGET_KSUID_RESOURCE).toString();
    this.#assertWritable(
      id,
      dashboardWidgetDefinitionSchema.safeParse({
        ...fields.input,
        version: DASHBOARD_WIDGET_DEFINITION_VERSION,
      }),
    );
    return this.#present(await this.#repository.createWidget({ ...fields, id }));
  }

  /** The repository merges the halves given into the stored half, which it parses first. */
  async updateWidget(input: UpdateDashboardWidgetInput & Viewed): Promise<DashboardWidget> {
    const { viewer: _viewer, ...fields } = input;
    await this.#assertEnabled(fields);
    await this.#visibleRow(input);
    this.#assertWritable(input.id, definitionUpdateSchema.safeParse(input.input));
    return this.#present(await this.#repository.updateWidget(fields));
  }

  async assignToDashboard(input: AssignDashboardWidgetInput & Viewed): Promise<DashboardWidget> {
    const { viewer: _viewer, ...fields } = input;
    await this.#assertEnabled(fields);
    await this.#visibleRow(input);
    await this.#assertBoardWritable(input);
    return this.#present(await this.#repository.assignToDashboard(fields));
  }

  async deleteWidget(input: DashboardWidgetScope & Viewed): Promise<void> {
    await this.#assertEnabled(input);
    await this.#visibleRow(input);
    return this.#repository.deleteWidget({ projectId: input.projectId, id: input.id });
  }

  /** A layout for a widget on a board the viewer may not see is skipped, like an unknown id. */
  async updateLayouts(input: DashboardWidgetLayoutsInput & Viewed): Promise<void> {
    await this.#assertEnabled(input);
    const hidden = await this.#hiddenWidgetIds(input);
    await this.#repository.updateLayouts({
      projectId: input.projectId,
      layouts: input.layouts.filter(({ graphId }) => !hidden.has(graphId)),
    });
  }

  async #visibleRows(input: { projectId: string } & Viewed): Promise<DashboardWidgetRow[]> {
    const [rows, hidden] = await Promise.all([
      this.#repository.findAll({ projectId: input.projectId }),
      this.#boards.findHiddenBoardIds(input),
    ]);
    return rows.filter((row) => row.dashboardId === null || !hidden.has(row.dashboardId));
  }

  /** One board's widgets, read from the project that owns it: this one, or another's. */
  async #boardRows(
    input: { projectId: string; dashboardId: string } & Viewed,
  ): Promise<DashboardWidgetRow[]> {
    const found = await this.#boards.findReadable(input);
    if (!found) throw new DashboardNotFoundError(input.projectId);
    const rows = await this.#repository.findAll({ projectId: found.board.projectId });
    return rows.filter((row) => row.dashboardId === input.dashboardId);
  }

  async #visibleRow(input: DashboardWidgetScope & Viewed): Promise<DashboardWidgetRow> {
    const row = await this.#repository.getById({ projectId: input.projectId, id: input.id });
    const onBoard = row.dashboardId;
    const hidden =
      onBoard !== null &&
      (await this.#boards.isHidden({
        projectId: input.projectId,
        dashboardId: onBoard,
        viewer: input.viewer,
      }));
    if (hidden) throw new DashboardWidgetNotFoundError();
    return row;
  }

  async #hiddenWidgetIds(input: { projectId: string } & Viewed): Promise<ReadonlySet<string>> {
    const hidden = await this.#boards.findHiddenBoardIds(input);
    if (hidden.size === 0) return new Set();
    const rows = await this.#repository.findAll({ projectId: input.projectId });
    const onHidden = rows.filter((row) => row.dashboardId !== null && hidden.has(row.dashboardId));
    return new Set(onHidden.map((row) => row.id));
  }

  /** A board the viewer cannot see is not found; the organization's, shown here, is read-only. */
  async #assertBoardWritable(
    input: { projectId: string; dashboardId: string } & Viewed,
  ): Promise<void> {
    const found = await this.#boards.findReadable(input);
    if (!found) throw new DashboardWidgetNotFoundError();
    if (found.standing === "guest") throw new DashboardReadOnlyHereError(input.projectId);
  }

  #assertEnabled({ projectId }: { projectId: string }): Promise<void> {
    return this.#analytics.assertCustomChartPlaygroundEnabled({ projectId });
  }

  /** Refuses before the write what `#present` would refuse after it, so no bad row is stored. */
  #assertWritable(
    widgetId: string,
    parsed: { success: true } | { success: false; error: Error },
  ): void {
    if (!parsed.success) {
      throw new DashboardWidgetDefinitionRefusedError(widgetId, { reasons: [parsed.error] });
    }
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
