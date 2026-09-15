import type {
  AnalyticsApi,
  LangWatchQLProtections,
  LangWatchQLQueryResult,
  LangWatchQLRunContext,
} from "@langwatch/analytics-contract";
import { generate } from "@langwatch/ksuid";
import {
  projectIdSchema,
  SAVED_WORKBENCH_CHART_KSUID_RESOURCE,
  savedWorkbenchChartDefinitionSchema,
  savedWorkbenchChartIdSchema,
  savedWorkbenchChartNameSchema,
  savedWorkbenchChartPlacementSchema,
  SavedWorkbenchChartDashboardNotFoundError,
  SavedWorkbenchChartDefinitionInvalidError,
  SavedWorkbenchChartNotFoundError,
  SavedWorkbenchChartValidationError,
  type SavedWorkbenchChart,
  type SavedWorkbenchChartDefinition,
  type SavedWorkbenchChartDefinitionUpdate,
  type SavedWorkbenchChartPlacement,
} from "@langwatch/dashboard-contract";
import type { DashboardRepository } from "../repositories/dashboard.repository.ts";
import type { SavedWorkbenchChartPolicyService } from "./saved-workbench-chart-policy.service.ts";

/** The rows this service reads and writes: saved charts, and where they sit. */
export type SavedWorkbenchChartRepository = Pick<
  DashboardRepository,
  | "createSavedWorkbenchChart"
  | "deleteSavedWorkbenchChart"
  | "findAllSavedWorkbenchCharts"
  | "findDashboard"
  | "findLastGraphGridRow"
  | "findSavedWorkbenchChart"
  | "placeSavedWorkbenchChart"
  | "unplaceSavedWorkbenchChart"
  | "updateSavedWorkbenchChart"
>;

/** The saved LangWatchQL charts a project keeps, and their placement on a grid. */
export class SavedWorkbenchChartService {
  #repository: SavedWorkbenchChartRepository;
  #policy: SavedWorkbenchChartPolicyService;
  #analytics: AnalyticsApi;

  private constructor(
    repository: SavedWorkbenchChartRepository,
    policy: SavedWorkbenchChartPolicyService,
    analytics: AnalyticsApi,
  ) {
    this.#repository = repository;
    this.#policy = policy;
    this.#analytics = analytics;
  }

  static create(options: {
    repository: SavedWorkbenchChartRepository;
    policy: SavedWorkbenchChartPolicyService;
    analytics: AnalyticsApi;
  }): SavedWorkbenchChartService {
    return new SavedWorkbenchChartService(options.repository, options.policy, options.analytics);
  }

  async getAll(input: { projectId: string }): Promise<SavedWorkbenchChart[]> {
    const rows = await this.#repository.findAllSavedWorkbenchCharts({
      projectId: projectIdSchema.parse(input.projectId),
    });

    return rows.map((row) => present(row));
  }

  async getById(input: { projectId: string; chartId: string }): Promise<SavedWorkbenchChart> {
    const parsed = chartRef(input);

    const chart = await this.#repository.findSavedWorkbenchChart(parsed);
    if (!chart) throw new SavedWorkbenchChartNotFoundError();

    return present(chart);
  }

  async create(input: {
    projectId: string;
    protections: LangWatchQLProtections;
    name: string;
    definition: unknown;
    id?: string;
  }): Promise<SavedWorkbenchChart> {
    const projectId = projectIdSchema.parse(input.projectId);
    const name = parseName(input.name);
    const definition = parseDefinition(input.definition);

    await this.#policy.validate({ projectId, protections: input.protections, definition });

    const chart = await this.#repository.createSavedWorkbenchChart({
      id:
        input.id === undefined
          ? generate(SAVED_WORKBENCH_CHART_KSUID_RESOURCE).toString()
          : parseId(input.id),
      projectId,
      name,
      definition,
    });

    return present(chart);
  }

  async update(input: {
    projectId: string;
    chartId: string;
    name?: string;
    definitionUpdate?: SavedWorkbenchChartDefinitionUpdate;
  }): Promise<SavedWorkbenchChart> {
    const parsed = chartRef(input);

    await this.getById(parsed);

    const name = input.name === undefined ? undefined : parseName(input.name);

    const definitionUpdate = input.definitionUpdate;
    const definition =
      definitionUpdate === undefined ? undefined : parseDefinition(definitionUpdate.definition);

    if (definition !== undefined && definitionUpdate !== undefined) {
      await this.#policy.validate({
        projectId: parsed.projectId,
        protections: definitionUpdate.protections,
        definition,
      });
    }

    return present(
      await this.#repository.updateSavedWorkbenchChart({ ...parsed, name, definition }),
    );
  }

  async delete(input: { projectId: string; chartId: string }): Promise<void> {
    await this.#repository.deleteSavedWorkbenchChart(chartRef(input));
  }

  async place(input: {
    projectId: string;
    chartId: string;
    dashboardId: string;
    gridColumn?: number;
    gridRow?: number;
    colSpan?: number;
    rowSpan?: number;
  }): Promise<SavedWorkbenchChart> {
    const ref = chartRef(input);

    const placement = parsePlacement({
      dashboardId: input.dashboardId,
      ...(input.gridColumn === undefined ? {} : { gridColumn: input.gridColumn }),
      ...(input.gridRow === undefined ? {} : { gridRow: input.gridRow }),
      ...(input.colSpan === undefined ? {} : { colSpan: input.colSpan }),
      ...(input.rowSpan === undefined ? {} : { rowSpan: input.rowSpan }),
    });

    const dashboard = await this.#repository.findDashboard({
      projectId: ref.projectId,
      dashboardId: placement.dashboardId,
    });
    if (!dashboard) throw new SavedWorkbenchChartDashboardNotFoundError();

    const gridRow =
      placement.gridRow ??
      ((await this.#repository.findLastGraphGridRow({
        projectId: ref.projectId,
        dashboardId: placement.dashboardId,
      })) ?? -1) + 1;

    return present(
      await this.#repository.placeSavedWorkbenchChart({
        ...ref,
        dashboardId: placement.dashboardId,
        gridColumn: placement.gridColumn ?? 0,
        gridRow,
        colSpan: placement.colSpan ?? 1,
        rowSpan: placement.rowSpan ?? 1,
      }),
    );
  }

  async unplace(input: { projectId: string; chartId: string }): Promise<SavedWorkbenchChart> {
    return present(await this.#repository.unplaceSavedWorkbenchChart(chartRef(input)));
  }

  async run(input: {
    projectId: string;
    chartId: string;
    execution: LangWatchQLRunContext;
  }): Promise<LangWatchQLQueryResult> {
    const chart = await this.getById({ projectId: input.projectId, chartId: input.chartId });

    return await this.#analytics.executeLangWatchQL({
      ...input.execution,
      sql: chart.definition.sql,
      parameters: chart.definition.parameters,
    });
  }
}

function present<T extends { id: string; definition: unknown }>(
  row: T,
): T & { definition: SavedWorkbenchChartDefinition } {
  const parsed = savedWorkbenchChartDefinitionSchema.safeParse(row.definition);
  if (!parsed.success) throw new SavedWorkbenchChartDefinitionInvalidError(row.id);

  return { ...row, definition: parsed.data };
}

function parseName(input: unknown): string {
  const parsed = savedWorkbenchChartNameSchema.safeParse(input);
  if (!parsed.success) throw new SavedWorkbenchChartValidationError(parsed.error);

  return parsed.data;
}

function parseId(input: unknown): string {
  const parsed = savedWorkbenchChartIdSchema.safeParse(input);
  if (!parsed.success) throw new SavedWorkbenchChartValidationError(parsed.error);

  return parsed.data;
}

function parseDefinition(input: unknown): SavedWorkbenchChartDefinition {
  const parsed = savedWorkbenchChartDefinitionSchema.safeParse(input);
  if (!parsed.success) throw new SavedWorkbenchChartValidationError(parsed.error);

  return parsed.data;
}

function parsePlacement(input: unknown): SavedWorkbenchChartPlacement {
  const parsed = savedWorkbenchChartPlacementSchema.safeParse(input);
  if (!parsed.success) throw new SavedWorkbenchChartValidationError(parsed.error);

  return parsed.data;
}

const chartRef = (input: { projectId: string; chartId: string }) => ({
  projectId: projectIdSchema.parse(input.projectId),
  chartId: input.chartId,
});
