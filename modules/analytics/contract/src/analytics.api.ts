import type { Authorization, RestCredentialPrincipal } from "@langwatch/authorization";
import { moduleApi } from "@langwatch/module";
import type { Instant } from "@langwatch/time";

import type {
  AnalyticsEvaluationReadInput,
  AnalyticsEvaluationRollupAppendBatchInput,
  AnalyticsEvaluationRollupAppendInput,
  AnalyticsEvaluationRow,
  AnalyticsEvaluationUpsertInput,
} from "./analytics.evaluation.ts";
import type {
  AnalyticsFeedbacksPageParams,
  AnalyticsFeedbacksPageResult,
  AnalyticsFeedbacksResult,
  AnalyticsFilterOption,
  AnalyticsMetricSource,
  AnalyticsReadInput,
  AnalyticsTimeseriesInput,
  AnalyticsTimeseriesReadOptions,
  AnalyticsTimeseriesResult,
  AnalyticsTopDocumentsResult,
} from "./analytics.timeseries.ts";
import type {
  DashboardWidgetDefinition,
  DashboardWidgetQuery,
  DashboardWidgetSource,
} from "./features/dashboard-widget/dashboard-widget-definition.ts";
import type { LangWatchQLKeyReach } from "./features/lwql/analytics-lwql.schemas.ts";
import type {
  LangWatchQLCaller,
  LangWatchQLExecuteInput,
  LangWatchQLPassInput,
  LangWatchQLProtections,
  LangWatchQLQueryResult,
  LangWatchQLRunCaller,
  LangWatchQLSchema,
  LangWatchQLTextHydrationInput,
  LangWatchQLValidationInput,
} from "./features/lwql/analytics.lwql.ts";
import type {
  LangWatchQLAcceptedStatement,
  LangWatchQLAppFunctionCall,
  LangWatchQLJudgementCall,
} from "./features/lwql/langwatch-ql-app-functions.ts";
import type { QueryReference } from "./features/lwql/query-reference.ts";

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
  /** What the card's info tip says; a widget without one shows no tip. */
  readonly description?: string;
  /** What Langy is drafted with when asked about the widget; Langy falls back without one. */
  readonly prompt?: string;
  /** Where the widget came from; an update without one keeps the stored source. */
  readonly source?: DashboardWidgetSource;
}

/** The proof a cost-gated read runs under (ADR-177 v4.15). */
export type CostReadOptions = { readonly authorization: Authorization };

/** The callable analytics capability shared by process peers. */
export interface AnalyticsApi {
  getTimeseries(
    input: AnalyticsTimeseriesInput,
    options?: AnalyticsTimeseriesReadOptions,
  ): Promise<AnalyticsTimeseriesResult>;
  /** The cost-gated reads below take the route's `cost:view` proof, as a series takes its own. */
  getFeedbacks(
    input: AnalyticsReadInput,
    options: CostReadOptions,
  ): Promise<AnalyticsFeedbacksResult>;
  /**
   * The same feedbacks as {@link getFeedbacks}, newest first, one bounded page at a time.
   * Refuses a cursor from another project or filter set with `validation_error`.
   */
  getFeedbacksPage(
    input: AnalyticsReadInput & AnalyticsFeedbacksPageParams,
    options: CostReadOptions,
  ): Promise<AnalyticsFeedbacksPageResult>;
  getTopUsedDocuments(
    input: AnalyticsReadInput,
    options: CostReadOptions,
  ): Promise<AnalyticsTopDocumentsResult>;
  filterOptions(
    input: {
      readonly projectId: string;
      readonly field: string;
      readonly startDate: number;
      readonly endDate: number;
      readonly query?: string;
      readonly key?: string;
      readonly subkey?: string;
      readonly filters?: Record<string, unknown>;
    },
    options: { readonly authorization: Authorization },
  ): Promise<AnalyticsFilterOption[]>;
  /** Refuses the dashboard-widget surface unless Dashboards and LangWatchQL are both on. */
  assertDashboardWidgetsEnabled(input: { projectId: string }): Promise<void>;
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
  /**
   * When the project's newest trace or evaluation since `since` occurred, from the analytics
   * tables this module owns; empty when none did. The graph-alert heartbeat reads it.
   * `excludeOrigins` leaves out traces of those origins; an evaluation read ignores it.
   */
  findLastOccurredAt(input: {
    readonly projectId: string;
    readonly source: AnalyticsMetricSource;
    readonly since: Instant;
    readonly excludeOrigins?: readonly string[];
  }): Promise<Instant[]>;
  isLangWatchQLAvailable(): boolean;
  /**
   * Whether the LangWatchQL app functions can be created so every replica sees
   * them. Empty where ClickHouse did not answer the settings the probe reads.
   */
  findAppFunctionsProvisionable(): Promise<boolean[]>;
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
   * Proves each project exists and holds `analytics:view` for the member, so a widget never
   * stores a project its writer could not read.
   * @throws LangWatchQLProjectNotFoundError with no id, for any that does not.
   */
  assertProjectsReadable(input: {
    userId?: string;
    /** The API key writing, whose reach a run would apply. It decides over `userId`. */
    reach?: LangWatchQLKeyReach;
    projectIds: readonly string[];
  }): Promise<void>;
  /**
   * Re-validates the statement with the full policy, eval gate taken from the caller's
   * answer, then runs it inside the fixed wrapper its pass names: an instant-eval read.
   */
  executeLangWatchQLPass(input: LangWatchQLPassInput): Promise<LangWatchQLQueryResult>;
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
  /** Whether this project's rollout admits it to the Dashboards area at all. */
  isDashboardsEnabled(input: { projectId: string }): Promise<boolean>;
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
