import type { LangWatchQLProtections, LangWatchQLService } from "@langwatch/analytics-contract";
import {
  SavedWorkbenchChartAlreadyExistsError as DashboardSavedWorkbenchChartAlreadyExistsError,
  SavedWorkbenchChartDashboardNotFoundError as DashboardSavedWorkbenchChartDashboardNotFoundError,
  SavedWorkbenchChartDefinitionInvalidError as DashboardSavedWorkbenchChartDefinitionInvalidError,
  SavedWorkbenchChartNotFoundError as DashboardSavedWorkbenchChartNotFoundError,
  type SavedWorkbenchChartDefinition,
} from "@langwatch/dashboard-contract";
import { SavedWorkbenchChartPolicy } from "@langwatch/dashboard-server";
import { createLogger } from "@langwatch/observability";
import {
  LWQL_QUERY_RESULT_DATASET,
  validateVegaLiteSpecStructure,
} from "@langwatch/analytics-web/validation";
import {
  SavedWorkbenchChartAlreadyExistsError,
  SavedWorkbenchChartDashboardNotFoundError,
  SavedWorkbenchChartDefinitionInvalidError,
  SavedWorkbenchChartNotFoundError,
  SavedWorkbenchChartSpecificationRefusedError,
} from "./dashboard-saved-workbench-chart.transport-errors";

const logger = createLogger("langwatch:dashboard:saved-workbench-chart-policy");

/** App composition of Analytics admission and the browser-safe Vega policy. */
export class AppSavedWorkbenchChartPolicy extends SavedWorkbenchChartPolicy {
  private constructor(private readonly langWatchQL: LangWatchQLService) {
    super();
  }

  static create(input: { langWatchQL: LangWatchQLService }): AppSavedWorkbenchChartPolicy {
    return new AppSavedWorkbenchChartPolicy(input.langWatchQL);
  }

  validate(input: {
    projectId: string;
    protections: LangWatchQLProtections;
    definition: SavedWorkbenchChartDefinition;
  }): void {
    this.langWatchQL.validate({
      projectId: input.projectId,
      protections: input.protections,
      sql: input.definition.sql,
      parameters: input.definition.parameters,
    });
    if (input.definition.vegaLiteSpec === undefined) return;

    const verdict = validateVegaLiteSpecStructure({
      spec: input.definition.vegaLiteSpec,
      registeredDatasets: [LWQL_QUERY_RESULT_DATASET],
    });
    if (verdict.ok) return;

    logger.info(
      {
        projectId: input.projectId,
        rules: verdict.errors.map((error) => error.rule),
      },
      "workbench chart specification refused by policy",
    );
    throw new SavedWorkbenchChartSpecificationRefusedError(verdict.errors);
  }
}

/** Keeps existing REST and tRPC handled-error response envelopes stable. */
export function mapDashboardSavedWorkbenchChartError(error: unknown): never {
  if (error instanceof DashboardSavedWorkbenchChartNotFoundError) {
    throw new SavedWorkbenchChartNotFoundError();
  }
  if (error instanceof DashboardSavedWorkbenchChartDashboardNotFoundError) {
    throw new SavedWorkbenchChartDashboardNotFoundError();
  }
  if (error instanceof DashboardSavedWorkbenchChartAlreadyExistsError) {
    throw new SavedWorkbenchChartAlreadyExistsError();
  }
  if (error instanceof DashboardSavedWorkbenchChartDefinitionInvalidError) {
    throw new SavedWorkbenchChartDefinitionInvalidError(error.chartId);
  }
  throw error;
}
