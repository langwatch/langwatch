import type { RestCredentialPrincipal } from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/kernel/module-api";
import type { Instant } from "@langwatch/time";

import type {
  AnalyticsEvaluationReadInput,
  AnalyticsEvaluationRollupAppendBatchInput,
  AnalyticsEvaluationRollupAppendInput,
  AnalyticsEvaluationRow,
  AnalyticsEvaluationUpsertInput,
} from "./analytics.evaluation.ts";
import type {
  LangWatchQLExecuteInput,
  LangWatchQLProtections,
  LangWatchQLQueryResult,
  LangWatchQLRunCaller,
  LangWatchQLSchema,
  LangWatchQLValidationInput,
} from "./analytics.lwql.ts";
import type {
  AnalyticsFeedbacksResult,
  AnalyticsFilterOption,
  AnalyticsReadInput,
  AnalyticsTimeseriesInput,
  AnalyticsTimeseriesResult,
  AnalyticsTopDocumentsResult,
} from "./analytics.timeseries.ts";
import type {
  DashboardWidgetDefinition,
  DashboardWidgetQuery,
} from "./dashboard-widget-definition.ts";

/** A persisted custom-chart-playground widget, parsed from its CustomGraph row. */
export interface DashboardWidget {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly definition: DashboardWidgetDefinition;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly dashboardId: string | null;
  readonly gridColumn: number;
  readonly gridRow: number;
  readonly colSpan: number;
  readonly rowSpan: number;
}

/** The author-editable part of one widget definition. */
export interface DashboardWidgetDefinitionInput {
  readonly code: string;
  readonly queries: readonly DashboardWidgetQuery[];
}

/** The callable analytics capability shared by process peers. */
export interface AnalyticsApi {
  getTimeseries(
    input: AnalyticsTimeseriesInput,
    options?: { readonly maxResultRows?: number },
  ): Promise<AnalyticsTimeseriesResult>;
  getFeedbacks(input: AnalyticsReadInput): Promise<AnalyticsFeedbacksResult>;
  getTopUsedDocuments(input: AnalyticsReadInput): Promise<AnalyticsTopDocumentsResult>;
  filterOptions(input: {
    readonly projectId: string;
    readonly field: string;
    readonly startDate: number;
    readonly endDate: number;
    readonly query?: string;
    readonly key?: string;
    readonly subkey?: string;
    readonly filters?: Record<string, unknown>;
  }): Promise<AnalyticsFilterOption[]>;
  /** Refuses the dashboard-widget surface while its project rollout is disabled. */
  assertCustomChartPlaygroundEnabled(input: { projectId: string }): Promise<void>;
  upsertEvaluationAnalytics(input: AnalyticsEvaluationUpsertInput): Promise<void>;
  upsertEvaluationAnalyticsBatch(input: AnalyticsEvaluationUpsertInput[]): Promise<void>;
  findEvaluationAnalytics(input: AnalyticsEvaluationReadInput): Promise<{
    row: AnalyticsEvaluationRow;
    appliedEventIds: string[];
  } | null>;
  appendEvaluationAnalyticsRollup(input: AnalyticsEvaluationRollupAppendInput): Promise<void>;
  appendEvaluationAnalyticsRollupBatch(
    input: AnalyticsEvaluationRollupAppendBatchInput,
  ): Promise<void>;
  isLangWatchQLAvailable(): boolean;
  /**
   * `isInstantEvalsEnabled` decides whether the eval functions are published
   * as available. The caller answers it; absent means no.
   */
  describeLangWatchQLSchema(input: {
    protections: LangWatchQLProtections;
    isInstantEvalsEnabled?: boolean;
  }): LangWatchQLSchema;
  validateLangWatchQL(input: LangWatchQLValidationInput): unknown;
  executeLangWatchQL(input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult>;
  /** Whether this project's rollout admits it to the Workbench at all. */
  isWorkbenchEnabled(input: { projectId: string }): Promise<boolean>;
  /** What one signed-in member may see of a project's content and spend. */
  resolveProtections(input: { userId: string; projectId: string }): Promise<LangWatchQLProtections>;
  /**
   * What an API key may see of a project's content and spend — the same
   * question {@link resolveProtections} answers for a signed-in member, asked
   * of the credential instead of a session.
   */
  resolveApiKeyProtections(input: {
    projectId: string;
    credential: RestCredentialPrincipal;
  }): Promise<LangWatchQLProtections>;
  /** The deep link back to the Workbench editor for a saved chart in this project. */
  savedWorkbenchChartPlatformUrl(input: { projectSlug: string }): string;
  /**
   * The restricted tenant identity a member's own statement runs as, together
   * with their protections. Refuses with `project_not_found` when the project
   * no longer exists.
   */
  resolveRunCaller(input: { userId: string; projectId: string }): Promise<LangWatchQLRunCaller>;
}

export const AnalyticsApi = moduleApi<AnalyticsApi>()("analytics");
