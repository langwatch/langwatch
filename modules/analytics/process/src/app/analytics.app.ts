import type { ClickHouseClient, ClickHouseSettings } from "@clickhouse/client";
/**
 * The analytics feature's application: what both doors call, holding every service and
 * port as the one typed thing a transport is given. A caller is always an argument,
 * never read from a session, so one operation serves a browser, an API key, or a background job.
 */
import {
  analyticsServerConfig,
  type AnalyticsServerConfig,
  AnalyticsApi as AnalyticsApiToken,
  CustomChartPlaygroundNotEnabledError,
  type AnalyticsFeedbacksResult,
  type AnalyticsFilterOption,
  type AnalyticsReadInput,
  type AnalyticsService,
  type AnalyticsTimeseriesInput,
  type AnalyticsTimeseriesReadOptions,
  type AnalyticsTimeseriesResult,
  type AnalyticsTopDocumentsResult,
  type LangWatchQLCaller,
  type LangWatchQLExecuteInput,
  type LangWatchQLProtections,
  type LangWatchQLQueryResult,
  type LangWatchQLRunCaller,
  type LangWatchQLAcceptedStatement,
  type LangWatchQLAppFunctionCall,
  type LangWatchQLJudgementCall,
  type LangWatchQLSchema,
  type LangWatchQLService,
  type LangWatchQLValidationInput,
  type AnalyticsApi as AnalyticsApiContract,
} from "@langwatch/analytics-contract";
import type { RestCredentialPrincipal } from "@langwatch/api/rest";
import { AuthzApi } from "@langwatch/authz-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { resolvePlatformDefaultRetentionDays } from "@langwatch/data-retention-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { NotFoundError } from "@langwatch/handled-error";
import type { FeatureSetup } from "@langwatch/kernel";
import type { RateLimiter } from "@langwatch/process-stores/members";
import { ProjectApi } from "@langwatch/project-contract";

import { AnalyticsAdapter } from "../app/analytics-composition.build.ts";
import { FilterOptionsAdapter } from "../app/filter-options-composition.build.ts";
import { createLangWatchQLService } from "../app/langwatch-ql-composition.build.ts";
import type { EvaluationAnalyticsClickHouseClient } from "../repositories/clickhouse/clickhouse.analytics-persistence.repository.ts";
import type { LangWatchQLConnection } from "../repositories/langwatch-ql-executor.repository.ts";
import { savedWorkbenchChartPlatformUrl as savedWorkbenchChartPlatformUrl_ } from "../rules/analytics-platform-url.rules.ts";
import { lwqlHydrationKeyCap } from "../rules/langwatch-ql-app-function-catalog.rules.ts";
import { statementMightCallEvalFunction } from "../rules/langwatch-ql-eval-function-catalog.rules.ts";
import { langWatchQLJudgementCalls } from "../rules/langwatch-ql-judgement-questions.rules.ts";
import { instantEvalsEnabled, lwqlEnabled } from "../rules/lwql-access.rules.ts";
import {
  resolveApiKeyProtections as resolveApiKeyProtectionsRule,
  resolveWorkbenchProtections,
  resolveWorkbenchRunCaller,
} from "../rules/workbench-protections.rules.ts";
import { CustomChartPlaygroundAccessService } from "../services/custom-chart-playground-access.service.ts";
import { LangWatchQLBoundsService } from "../services/langwatch-ql-bounds.service.ts";
import type { AnalyticsQueryApi } from "../transport/query.rest.ts";

/**
 * The filter-value read this feature makes on the host's filter registry — declared
 * as the one method it calls, since which fields exist and what a stored filter means
 * is the host's catalogue, not Analytics' own.
 */
export type AnalyticsFilterOptionsLookup = Readonly<{
  getFilterOptions(
    input: Readonly<{
      projectId: string;
      field: string;
      query?: string;
      key?: string;
      subkey?: string;
      startDate: number;
      endDate: number;
      scopeFilters?: Record<string, unknown>;
    }>,
  ): Promise<AnalyticsFilterOption[]>;
}>;

/** What one filter picker is asking for, before the narrowing rule is applied. */
export type AnalyticsFilterOptionsRequest = Readonly<{
  projectId: string;
  field: string;
  startDate: number;
  endDate: number;
  query?: string | undefined;
  key?: string | undefined;
  subkey?: string | undefined;
  /** Every filter currently applied, including the one being selected. */
  filters?: Record<string, unknown> | undefined;
}>;

/** What the process composes this feature's application from. */
export interface AnalyticsAppDependencies {
  analytics: AnalyticsService;
  /** The host's filter catalogue; see {@link AnalyticsFilterOptionsLookup}. */
  filterOptions: AnalyticsFilterOptionsLookup;
  langWatchQL: LangWatchQLService;
  /** The Workbench's rollout gate and its two independent protection sources. */
  featureFlags: FeatureFlagApi;
  authz: AuthzApi;
  dataPrivacy: DataPrivacyApi;
  /** The SAME project peer the rollout gate and the run-caller's identity read. */
  projects: ProjectApi;
  /** The per-project window every LangWatchQL execution is counted against. */
  lwqlBounds: LangWatchQLBoundsService;
}

export type AnalyticsInfrastructure = Readonly<{
  resolveClickHouseClient: ((tenantId: string) => Promise<ClickHouseClient | null>) | null;
  clickhouseEnabled?: boolean;
  defaultRetentionDays?: number;
}>;

/** The peer modules the Workbench's access rules read, resolved through their own tokens. */
type AnalyticsDependencies = Readonly<{
  featureFlags: typeof FeatureFlagApi;
  authz: typeof AuthzApi;
  dataPrivacy: typeof DataPrivacyApi;
  projects: typeof ProjectApi;
  /** The plan the LangWatchQL execution window resolves through. */
  plans: typeof EntitlementApi;
}>;

/**
 * Shapes restated rather than imported from `@langwatch/process-stores`: a
 * module depends on contracts. `publicBaseUrl` is the process's own fact,
 * absent where the deployment named no `BASE_HOST`.
 */
type AnalyticsMembers = Readonly<{
  clickhouse: ClickHouseQueryClient;
  rateLimiter: RateLimiter;
  publicBaseUrl: string | undefined;
}>;

type AnalyticsSetup = FeatureSetup<AnalyticsDependencies, AnalyticsMembers, AnalyticsServerConfig>;

const isPresent = (value: string | undefined): value is string => Boolean(value);

const langWatchQlConnection = (values: readonly string[]): LangWatchQLConnection => {
  const [url, username, password, database, tenantSetting] = values;
  if (!url || !username || !password || !database || !tenantSetting) {
    throw new Error("LangWatchQL connection is incomplete");
  }
  return { url, username, password, database, tenantSetting };
};

/**
 * Adapts the process's one routing `clickhouse` member to the per-tenant session
 * shape Analytics' repositories expect. Not a second connection — the member already
 * routes and guards every statement by `tenantId`; this just carries that tenant on.
 */
class ClickHouseMemberSession implements EvaluationAnalyticsClickHouseClient {
  constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly tenantId: string,
  ) {}

  async query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<{ json(): Promise<Record<string, unknown>[]> }> {
    const { rows } = await this.clickhouse.query<Record<string, unknown>>({
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params,
      settings: input.clickhouse_settings as Record<string, string | number> | undefined,
    });
    return { json: () => Promise.resolve(rows) };
  }

  async insert(input: {
    table: string;
    values: Record<string, unknown>[];
    format: "JSONEachRow";
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<unknown> {
    await this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values,
      settings: input.clickhouse_settings as Record<string, string | number> | undefined,
    });
    return undefined;
  }
}

/**
 * Both doors' shapes are declared in the `implements` clause, not left to agree by
 * attention: a transport reaches this object through the operations-only feature-API
 * proxy, so an unserved operation is a runtime `TypeError`, not a caught type error.
 */
export class AnalyticsApp implements AnalyticsApiContract, AnalyticsQueryApi {
  static readonly contract = AnalyticsApiToken;
  static readonly dependencies = {
    featureFlags: FeatureFlagApi,
    authz: AuthzApi,
    dataPrivacy: DataPrivacyApi,
    projects: ProjectApi,
    plans: EntitlementApi,
  };
  static readonly config = analyticsServerConfig;
  /**
   * `rateLimiter` is the per-project counter every LangWatchQL execution is
   * checked against. All three names are from the process's vocabulary; boot
   * refuses by name.
   */
  static readonly reads = ["clickhouse", "rateLimiter", "publicBaseUrl"] as const;

  static create(setup: AnalyticsSetup): AnalyticsApp {
    const clickhouse = setup.members.clickhouse;
    const resolveClient = (tenantId: string): Promise<EvaluationAnalyticsClickHouseClient> =>
      Promise.resolve(new ClickHouseMemberSession(clickhouse, tenantId));
    const analytics = AnalyticsAdapter.create({
      resolveClient,
      // The member is a `reads("clickhouse")` claim: boot refuses this
      // process before `create()` runs if no ClickHouse was configured, so by
      // the time this constructs, ClickHouse is always available.
      clickhouseEnabled: true,
      defaultRetentionDays: resolvePlatformDefaultRetentionDays(process.env),
    });
    const langwatchQl = setup.config.langwatchQl;
    const connectionValues = [
      langwatchQl.url,
      langwatchQl.username,
      langwatchQl.password,
      langwatchQl.database,
      langwatchQl.tenantSetting,
    ];
    const connection: LangWatchQLConnection | null = connectionValues.every(isPresent)
      ? langWatchQlConnection(connectionValues)
      : null;
    const langWatchQL = createLangWatchQLService({ connection });
    setup.resources.own("Analytics LangWatchQL identity", () => langWatchQL.close());
    return new AnalyticsApp(
      {
        analytics,
        filterOptions: FilterOptionsAdapter.create({ resolveClient }),
        langWatchQL,
        featureFlags: setup.dependencies.featureFlags,
        authz: setup.dependencies.authz,
        dataPrivacy: setup.dependencies.dataPrivacy,
        projects: setup.dependencies.projects,
        lwqlBounds: LangWatchQLBoundsService.create({
          entitlement: setup.dependencies.plans,
          projects: setup.dependencies.projects,
          rateLimiter: setup.members.rateLimiter,
        }),
      },
      setup.members.publicBaseUrl,
    );
  }

  #dependencies: AnalyticsAppDependencies;
  #publicBaseUrl: string | undefined;
  #playgroundAccess: CustomChartPlaygroundAccessService;

  private constructor(dependencies: AnalyticsAppDependencies, publicBaseUrl: string | undefined) {
    this.#dependencies = dependencies;
    this.#publicBaseUrl = publicBaseUrl;
    this.#playgroundAccess = CustomChartPlaygroundAccessService.create(dependencies);
  }

  /** The series behind every analytics chart and every dashboard graph card. */
  getTimeseries(
    input: AnalyticsTimeseriesInput,
    options?: AnalyticsTimeseriesReadOptions,
  ): Promise<AnalyticsTimeseriesResult> {
    return this.#dependencies.analytics.getTimeseries(input, options);
  }

  /** The retrieval documents a project's traces cite most. */
  getTopUsedDocuments(input: AnalyticsReadInput): Promise<AnalyticsTopDocumentsResult> {
    return this.#dependencies.analytics.getTopUsedDocuments(input);
  }

  /** The thumbs and comments left on the project's messages. */
  getFeedbacks(input: AnalyticsReadInput): Promise<AnalyticsFeedbacksResult> {
    return this.#dependencies.analytics.getFeedbacks(input);
  }

  /**
   * The values one filter field can offer, narrowed by every OTHER filter already applied
   * — never by the field's own selection, or the picker could only re-offer what's already
   * chosen. Forgetting this exclusion wouldn't fail; it would quietly narrow the answer.
   */
  filterOptions(request: AnalyticsFilterOptionsRequest): Promise<AnalyticsFilterOption[]> {
    const scopeFilters = Object.fromEntries(
      Object.entries(request.filters ?? {}).filter(([name]) => name !== request.field),
    );

    return this.#dependencies.filterOptions.getFilterOptions({
      projectId: request.projectId,
      field: request.field,
      ...(request.query === undefined ? {} : { query: request.query }),
      ...(request.key === undefined ? {} : { key: request.key }),
      ...(request.subkey === undefined ? {} : { subkey: request.subkey }),
      startDate: request.startDate,
      endDate: request.endDate,
      scopeFilters,
    });
  }

  /**
   * Whether this deployment has a LangWatchQL identity to run statements as. A
   * deployment without one can still describe the catalogue, which is why the
   * workbench gates its navigation on this rather than on the schema.
   */
  isLangWatchQLAvailable(): boolean {
    return this.#dependencies.langWatchQL.available;
  }

  /** The datasets and columns one member's protections unlock. */
  async describeLangWatchQLSchema(
    input: Readonly<{ projectId: string; protections: LangWatchQLProtections }>,
  ): Promise<LangWatchQLSchema> {
    return this.#dependencies.langWatchQL.describeSchema({
      protections: input.protections,
      isInstantEvalsEnabled: await this.#isInstantEvalsEnabled(input.projectId),
    });
  }

  /**
   * Runs one submitted statement exactly as it was written, counted against the
   * project's window first so an over-limit caller never reaches the engine.
   */
  async executeLangWatchQL(input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult> {
    await this.#dependencies.lwqlBounds.assertQueryWithinBounds({ projectId: input.project.id });

    // Resolved before the engine validates, because whether an eval function
    // may be called is part of that verdict — and only for a statement that
    // names one, since the answer costs a project read and a flag evaluation.
    const isInstantEvalsEnabled =
      statementMightCallEvalFunction(input.sql) &&
      (await this.#isInstantEvalsEnabled(input.project.id));

    return this.#dependencies.langWatchQL.execute({ ...input, isInstantEvalsEnabled });
  }

  /** This project's eval-function rollout, the one answer both paths above read. */
  #isInstantEvalsEnabled(projectId: string): Promise<boolean> {
    return instantEvalsEnabled({
      featureFlags: this.#dependencies.featureFlags,
      projectId,
      projects: this.#dependencies.projects,
    });
  }

  upsertEvaluationAnalytics(
    input: Parameters<AnalyticsService["upsertEvaluationAnalytics"]>[0],
  ): Promise<void> {
    return this.#dependencies.analytics.upsertEvaluationAnalytics(input);
  }

  upsertEvaluationAnalyticsBatch(
    input: Parameters<AnalyticsService["upsertEvaluationAnalyticsBatch"]>[0],
  ): Promise<void> {
    return this.#dependencies.analytics.upsertEvaluationAnalyticsBatch(input);
  }

  findEvaluationAnalytics(
    input: Parameters<AnalyticsService["findEvaluationAnalytics"]>[0],
  ): ReturnType<AnalyticsService["findEvaluationAnalytics"]> {
    return this.#dependencies.analytics.findEvaluationAnalytics(input);
  }

  appendEvaluationAnalyticsRollup(
    input: Parameters<AnalyticsService["appendEvaluationAnalyticsRollup"]>[0],
  ): Promise<void> {
    return this.#dependencies.analytics.appendEvaluationAnalyticsRollup(input);
  }

  appendEvaluationAnalyticsRollupBatch(
    input: Parameters<AnalyticsService["appendEvaluationAnalyticsRollupBatch"]>[0],
  ): Promise<void> {
    return this.#dependencies.analytics.appendEvaluationAnalyticsRollupBatch(input);
  }

  validateLangWatchQL(input: LangWatchQLValidationInput): LangWatchQLAcceptedStatement {
    return this.#dependencies.langWatchQL.validate(input);
  }

  /** The judged columns a hydration plan asks for, read off this catalogue. */
  describeLangWatchQLJudgements(input: {
    appFunctions: readonly LangWatchQLAppFunctionCall[];
  }): readonly LangWatchQLJudgementCall[] {
    return langWatchQLJudgementCalls(input.appFunctions);
  }

  /** The keys one execution of this plan may hydrate, the lowest cap winning. */
  langWatchQLKeyCapFor(input: { appFunctions: readonly LangWatchQLAppFunctionCall[] }): number {
    return lwqlHydrationKeyCap(input.appFunctions);
  }

  /** Whether this project's rollout admits it to the Workbench at all. */
  isWorkbenchEnabled(input: { projectId: string }): Promise<boolean> {
    return lwqlEnabled({
      featureFlags: this.#dependencies.featureFlags,
      projectId: input.projectId,
      projects: this.#dependencies.projects,
    });
  }

  /** What one signed-in member may see of a project's content and spend. */
  resolveProtections(input: {
    userId: string;
    projectId: string;
  }): Promise<LangWatchQLProtections> {
    return resolveWorkbenchProtections({
      authz: this.#dependencies.authz,
      dataPrivacy: this.#dependencies.dataPrivacy,
      userId: input.userId,
      projectId: input.projectId,
    });
  }

  /**
   * What an API key may see of a project's content and spend — the same
   * question {@link resolveProtections} answers for a signed-in member, asked
   * of the credential instead of a session.
   */
  resolveApiKeyProtections(input: {
    projectId: string;
    credential: RestCredentialPrincipal;
  }): Promise<LangWatchQLProtections> {
    return resolveApiKeyProtectionsRule({
      authz: this.#dependencies.authz,
      dataPrivacy: this.#dependencies.dataPrivacy,
      projectId: input.projectId,
      credential: input.credential,
    });
  }

  /**
   * The deep link back to the Workbench editor for a saved chart in this
   * project. A deployment that serves the Workbench but named no public
   * origin refuses by name.
   */
  savedWorkbenchChartPlatformUrl(input: { projectSlug: string }): string {
    if (this.#publicBaseUrl === undefined) {
      throw new Error(
        "The analytics workbench was asked for a platform link, but this deployment named no public base URL",
      );
    }

    return savedWorkbenchChartPlatformUrl_({
      publicBaseUrl: this.#publicBaseUrl,
      projectSlug: input.projectSlug,
    });
  }

  /**
   * The restricted tenant identity a member's own statement runs as, read through the
   * same project peer the rollout gate reads — never a raw Prisma client in this App.
   * Refuses with `project_not_found` when the project no longer exists.
   */
  resolveRunCaller(input: { userId: string; projectId: string }): Promise<LangWatchQLRunCaller> {
    return resolveWorkbenchRunCaller({
      authz: this.#dependencies.authz,
      dataPrivacy: this.#dependencies.dataPrivacy,
      projects: this.#dependencies.projects,
      userId: input.userId,
      projectId: input.projectId,
    });
  }

  /**
   * The same restricted tenant identity, for a CREDENTIAL rather than a member. Stops at
   * the project because an API key's protections are already resolved as a transport fact
   * by `resolveApiKeyProtections` — resolving them again here could only disagree.
   */
  async resolveApiKeyRunCaller(input: Readonly<{ projectId: string }>): Promise<LangWatchQLCaller> {
    const project = await this.#dependencies.projects.findById(input.projectId);
    if (!project) {
      throw new NotFoundError("project_not_found", "Project", input.projectId);
    }

    return { id: project.id, lwqlKey: project.lwqlKey };
  }

  /**
   * This must be implemented on the bound app so refusal returns the domain 403
   * instead of the feature-api proxy's “not callable” error.
   */
  async assertCustomChartPlaygroundEnabled(input: { projectId: string }): Promise<void> {
    const enabled = await this.#playgroundAccess.isEnabled(input);

    if (!enabled) throw new CustomChartPlaygroundNotEnabledError();
  }
}
