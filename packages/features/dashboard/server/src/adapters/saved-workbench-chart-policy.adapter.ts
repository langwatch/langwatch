import type { LangWatchQLProtections, LangWatchQLService } from "@langwatch/analytics-contract";
import {
  SavedWorkbenchChartValidationError,
  savedWorkbenchChartDefinitionSchema,
  type SavedWorkbenchChartDefinition,
} from "@langwatch/dashboard-contract";
import { SavedWorkbenchChartPolicy } from "../ports/dashboard.port";
import { createLogger } from "@langwatch/observability";
import {
  LWQL_QUERY_RESULT_DATASET,
  validateVegaLiteSpecStructure,
} from "@langwatch/analytics-contract/visualization/validation";
import { SavedWorkbenchChartSpecificationRefusedError } from "../transport/api-trpc/saved-workbench-chart.transport-errors";

const logger = createLogger("langwatch:dashboard:saved-workbench-chart-policy");

/** App composition of Analytics admission and the browser-safe Vega policy. */
export class AnalyticsSavedWorkbenchChartPolicyAdapter extends SavedWorkbenchChartPolicy {
  private constructor(private readonly langWatchQL: LangWatchQLService) {
    super();
  }

  static create(input: {
    langWatchQL: LangWatchQLService;
  }): AnalyticsSavedWorkbenchChartPolicyAdapter {
    return new AnalyticsSavedWorkbenchChartPolicyAdapter(input.langWatchQL);
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

  /**
   * The same gate applied to a definition that has not been read yet.
   *
   * The tRPC transport admits a definition against the CALLER's own
   * protections before the service is reached — the one place they are known —
   * and needs the parsed value back to store. Parsing here rather than in the
   * transport keeps the versioned schema and both governors in one place, so
   * a definition this refuses is not a definition the service would keep.
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
