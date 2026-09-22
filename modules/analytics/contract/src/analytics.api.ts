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
  LangWatchQLCaller,
  LangWatchQLExecuteInput,
  LangWatchQLProtections,
  LangWatchQLQueryResult,
  LangWatchQLRunCaller,
  LangWatchQLSchema,
  LangWatchQLTextHydrationInput,
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
import type {
  LangWatchQLAcceptedStatement,
  LangWatchQLAppFunctionCall,
  LangWatchQLJudgementCall,
} from "./langwatch-ql-app-functions.ts";
import type { QueryReference } from "./query-reference.ts";

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
   * The database this deployment's LangWatchQL views live in, which a module
   * writing a statement against them has to name.
   */
  langWatchQLDatabase(): string;
  /**
   * Whether the eval functions are published as available is Analytics' own
   * answer, read from this project's rollout — which is why the project is
   * named and the caller never states the gate.
   */
  describeLangWatchQLSchema(input: {
    projectId: string;
    protections: LangWatchQLProtections;
  }): Promise<LangWatchQLSchema>;
  /**
   * Both query languages in one document, pure apart from the caller's own
   * reach, so the door answers it from memory. See ADR-154.
   */
  describeQueryReference(input: {
    projectId: string;
    protections: LangWatchQLProtections;
    canRunLangWatchQL: boolean;
  }): Promise<QueryReference>;
  /**
   * Admits a statement, or throws the refusal. The verdict is what a caller
   * storing or paging the statement needs from it, and nothing more.
   */
  validateLangWatchQL(input: LangWatchQLValidationInput): LangWatchQLAcceptedStatement;
  /**
   * The judged columns a hydration plan asks for, in the catalogue's own
   * vocabulary. Derived here because the catalogue is LangWatchQL's: which
   * option of an eval function is its threshold, range or list is its answer.
   */
  describeLangWatchQLJudgements(input: {
    appFunctions: readonly LangWatchQLAppFunctionCall[];
  }): readonly LangWatchQLJudgementCall[];
  /**
   * The keys one execution of a hydration plan may hydrate, the lowest cap
   * winning. Answered here because the caps are the catalogue's: a statement
   * over conversations is bound far below one over traces.
   */
  langWatchQLKeyCapFor(input: { appFunctions: readonly LangWatchQLAppFunctionCall[] }): number;
  executeLangWatchQL(input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult>;
  /**
   * The extraction half of a judged plan: the same page with every judged
   * column holding the text that would be judged rather than a verdict. No
   * judge is called, so reading what a run judges costs nothing to judge.
   */
  hydrateLangWatchQLTexts(
    input: LangWatchQLTextHydrationInput,
  ): Promise<readonly Record<string, unknown>[]>;
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
  /**
   * Whether this credential reaches LangWatchQL at all — the one caller fact
   * the reference document depends on. Asked of the key rather than enforced,
   * because a key entitled only to traces still reads the filter half.
   */
  canApiKeyRunLangWatchQL(input: { credential: RestCredentialPrincipal }): Promise<boolean>;
  /**
   * What the PROJECT itself may see, with nobody asking — the protections a
   * job judging that project's own rows runs under, where there is neither a
   * session nor a credential to resolve.
   */
  resolveProjectProtections(
    input: Readonly<{ projectId: string }>,
  ): Promise<LangWatchQLProtections>;
  /** The deep link back to the Workbench editor for a saved chart in this project. */
  savedWorkbenchChartPlatformUrl(input: { projectSlug: string }): string;
  /**
   * The restricted tenant identity a member's own statement runs as, together
   * with their protections. Refuses with `project_not_found` when the project
   * no longer exists.
   */
  resolveRunCaller(input: { userId: string; projectId: string }): Promise<LangWatchQLRunCaller>;
  /**
   * What the PROJECT itself may see, with nobody asking — what a job judging that
   * project's own rows runs under, with neither a session nor a credential.
   */
  resolveApiKeyRunCaller(input: Readonly<{ projectId: string }>): Promise<LangWatchQLCaller>;
}

export const AnalyticsApi = moduleApi<AnalyticsApi>()("analytics");
