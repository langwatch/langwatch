import type { AnalyticsApi, LangWatchQLProtections } from "@langwatch/analytics-contract";
import {
  LWQL_QUERY_RESULT_DATASET,
  validateVegaLiteSpecStructure,
} from "@langwatch/analytics-contract/visualization/validation";
import {
  savedWorkbenchChartDefinitionSchema,
  SavedWorkbenchChartSpecificationRefusedError,
  SavedWorkbenchChartValidationError,
  type SavedWorkbenchChartDefinition,
} from "@langwatch/dashboard-contract";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:dashboard:saved-workbench-chart-policy");

/**
 * What a saved chart's definition must satisfy before it is stored: the
 * LangWatchQL admission Analytics owns, and the browser-safe Vega policy.
 */
export class SavedWorkbenchChartPolicyService {
  #analytics: AnalyticsApi;

  private constructor(analytics: AnalyticsApi) {
    this.#analytics = analytics;
  }

  static create(options: { analytics: AnalyticsApi }): SavedWorkbenchChartPolicyService {
    return new SavedWorkbenchChartPolicyService(options.analytics);
  }

  validate(input: {
    projectId: string;
    protections: LangWatchQLProtections;
    definition: SavedWorkbenchChartDefinition;
  }): void {
    this.#analytics.validateLangWatchQL({
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
      { projectId: input.projectId, rules: verdict.errors.map((error) => error.rule) },
      "workbench chart specification refused by policy",
    );
    throw new SavedWorkbenchChartSpecificationRefusedError(verdict.errors);
  }

  /**
   * The same gate applied to a definition that has not been read yet, for a
   * caller whose own protections decide what it may name.
   */
  admit(input: {
    projectId: string;
    protections: LangWatchQLProtections;
    definition: unknown;
  }): SavedWorkbenchChartDefinition {
    const parsed = savedWorkbenchChartDefinitionSchema.safeParse(input.definition);
    if (!parsed.success) throw new SavedWorkbenchChartValidationError(parsed.error);

    this.validate({
      projectId: input.projectId,
      protections: input.protections,
      definition: parsed.data,
    });

    return parsed.data;
  }
}
