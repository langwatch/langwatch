import {
  type LangWatchQLProtections,
  type LangWatchQLQueryResult,
  type LangWatchQLRunContext,
  type LangWatchQLService,
} from "@langwatch/analytics-contract";
import {
  SavedWorkbenchChartDashboardNotFoundError,
  SavedWorkbenchChartDefinitionInvalidError,
  SavedWorkbenchChartDefinitionUpdateProtectionsRequiredError,
  SavedWorkbenchChartNotFoundError,
  SavedWorkbenchChartValidationError,
  projectIdSchema,
  savedWorkbenchChartDefinitionSchema,
  savedWorkbenchChartIdSchema,
  savedWorkbenchChartNameSchema,
  savedWorkbenchChartPlacementSchema,
  type SavedWorkbenchChart,
  type SavedWorkbenchChartDefinition,
  type SavedWorkbenchChartDefinitionUpdate,
} from "@langwatch/dashboard-contract";
import type {
  DashboardIdGenerator,
  DashboardRepository,
  SavedWorkbenchChartPolicy,
} from "../ports/dashboard.port";

/**
 * The saved workbench chart half of the dashboard capability.
 *
 * Owned privately by DashboardService, which stays the only public surface.
 */
export class SavedWorkbenchChartService {
  private constructor(
    private readonly repository: DashboardRepository,
    private readonly ids: DashboardIdGenerator,
    private readonly policy: SavedWorkbenchChartPolicy,
    private readonly langWatchQL: LangWatchQLService,
  ) {}

  static create(options: {
    repository: DashboardRepository;
    ids: DashboardIdGenerator;
    savedWorkbenchChartPolicy: SavedWorkbenchChartPolicy;
    langWatchQL: LangWatchQLService;
  }): SavedWorkbenchChartService {
    return new SavedWorkbenchChartService(
      options.repository,
      options.ids,
      options.savedWorkbenchChartPolicy,
      options.langWatchQL,
    );
  }

  async getAll(input: { projectId: string }): Promise<SavedWorkbenchChart[]> {
    const rows = await this.repository.findAllSavedWorkbenchCharts({
      projectId: projectIdSchema.parse(input.projectId),
    });

    return rows.map((row) => presentSavedWorkbenchChart(row));
  }

  async getById(input: { projectId: string; chartId: string }): Promise<SavedWorkbenchChart> {
    const parsed = zSavedChartRef(input);

    const chart = await this.repository.tryFindSavedWorkbenchChart(parsed);
    if (!chart) {
      throw new SavedWorkbenchChartNotFoundError();
    }

    return presentSavedWorkbenchChart(chart);
  }

  async create(input: {
    projectId: string;
    protections: LangWatchQLProtections;
    name: string;
    definition: unknown;
    id?: string;
  }): Promise<SavedWorkbenchChart> {
    const projectId = projectIdSchema.parse(input.projectId);

    const name = parseSavedWorkbenchChartName(input.name);

    const definition = parseSavedWorkbenchChartDefinition(input.definition);

    await this.policy.validate({
      projectId,
      protections: input.protections,
      definition,
    });

    const chart = await this.repository.createSavedWorkbenchChart({
      id: input.id === undefined ? this.ids.generate() : parseSavedWorkbenchChartId(input.id),
      projectId,
      name,
      definition,
    });

    return presentSavedWorkbenchChart(chart);
  }

  async update(input: {
    projectId: string;
    chartId: string;
    name?: string;
    definitionUpdate?: SavedWorkbenchChartDefinitionUpdate;
  }): Promise<SavedWorkbenchChart> {
    const parsed = zSavedChartRef(input);

    await this.getById(parsed);

    const name = input.name === undefined ? undefined : parseSavedWorkbenchChartName(input.name);

    const definitionUpdate = input.definitionUpdate;
    if (definitionUpdate !== undefined && definitionUpdate.protections === undefined) {
      throw new SavedWorkbenchChartDefinitionUpdateProtectionsRequiredError();
    }

    const definition =
      definitionUpdate === undefined
        ? undefined
        : parseSavedWorkbenchChartDefinition(definitionUpdate.definition);

    if (definition !== undefined && definitionUpdate !== undefined) {
      await this.policy.validate({
        projectId: parsed.projectId,
        protections: definitionUpdate.protections,
        definition,
      });
    }

    const chart = await this.repository.tryUpdateSavedWorkbenchChart({
      ...parsed,
      name,
      definition,
    });
    if (!chart) {
      throw new SavedWorkbenchChartNotFoundError();
    }

    return presentSavedWorkbenchChart(chart);
  }

  async delete(input: { projectId: string; chartId: string }): Promise<void> {
    const parsed = zSavedChartRef(input);

    const count = await this.repository.deleteSavedWorkbenchChart(parsed);
    if (count === 0) {
      throw new SavedWorkbenchChartNotFoundError();
    }
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
    const ref = zSavedChartRef(input);

    const placement = parseSavedWorkbenchChartPlacement({
      dashboardId: input.dashboardId,
      ...(input.gridColumn === undefined ? {} : { gridColumn: input.gridColumn }),
      ...(input.gridRow === undefined ? {} : { gridRow: input.gridRow }),
      ...(input.colSpan === undefined ? {} : { colSpan: input.colSpan }),
      ...(input.rowSpan === undefined ? {} : { rowSpan: input.rowSpan }),
    });

    const dashboard = await this.repository.tryFindDashboard({
      projectId: ref.projectId,
      dashboardId: placement.dashboardId,
    });
    if (!dashboard) {
      throw new SavedWorkbenchChartDashboardNotFoundError();
    }

    const gridRow =
      placement.gridRow ??
      ((await this.repository.tryFindLastGraphGridRow({
        projectId: ref.projectId,
        dashboardId: placement.dashboardId,
      })) ?? -1) + 1;

    const chart = await this.repository.tryPlaceSavedWorkbenchChart({
      ...ref,
      dashboardId: placement.dashboardId,
      gridColumn: placement.gridColumn ?? 0,
      gridRow,
      colSpan: placement.colSpan ?? 1,
      rowSpan: placement.rowSpan ?? 1,
    });
    if (!chart) {
      throw new SavedWorkbenchChartNotFoundError();
    }

    return presentSavedWorkbenchChart(chart);
  }

  async unplace(input: { projectId: string; chartId: string }): Promise<SavedWorkbenchChart> {
    const chart = await this.repository.tryUnplaceSavedWorkbenchChart(zSavedChartRef(input));
    if (!chart) {
      throw new SavedWorkbenchChartNotFoundError();
    }

    return presentSavedWorkbenchChart(chart);
  }

  async run(input: {
    projectId: string;
    chartId: string;
    execution: LangWatchQLRunContext;
  }): Promise<LangWatchQLQueryResult> {
    const chart = await this.getById({
      projectId: input.projectId,
      chartId: input.chartId,
    });

    return await this.langWatchQL.execute({
      ...input.execution,
      sql: chart.definition.sql,
      parameters: chart.definition.parameters,
    });
  }
}

const zSavedChartRef = (input: { projectId: string; chartId: string }) => ({
  projectId: projectIdSchema.parse(input.projectId),
  chartId: input.chartId,
});

function presentSavedWorkbenchChart<T extends { id: string; definition: unknown }>(
  row: T,
): T & { definition: SavedWorkbenchChartDefinition } {
  const parsed = savedWorkbenchChartDefinitionSchema.safeParse(row.definition);
  if (!parsed.success) {
    throw new SavedWorkbenchChartDefinitionInvalidError(row.id);
  }

  return { ...row, definition: parsed.data };
}

function parseSavedWorkbenchChartName(input: unknown): string {
  const parsed = savedWorkbenchChartNameSchema.safeParse(input);
  if (!parsed.success) throw new SavedWorkbenchChartValidationError(parsed.error);
  return parsed.data;
}

function parseSavedWorkbenchChartId(input: unknown): string {
  const parsed = savedWorkbenchChartIdSchema.safeParse(input);
  if (!parsed.success) throw new SavedWorkbenchChartValidationError(parsed.error);
  return parsed.data;
}

function parseSavedWorkbenchChartDefinition(input: unknown): SavedWorkbenchChartDefinition {
  const parsed = savedWorkbenchChartDefinitionSchema.safeParse(input);
  if (!parsed.success) throw new SavedWorkbenchChartValidationError(parsed.error);
  return parsed.data;
}

function parseSavedWorkbenchChartPlacement(input: unknown) {
  const parsed = savedWorkbenchChartPlacementSchema.safeParse(input);
  if (!parsed.success) throw new SavedWorkbenchChartValidationError(parsed.error);
  return parsed.data;
}
