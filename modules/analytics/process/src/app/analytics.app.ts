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
  MAX_LWQL_LENGTH,
  type AnalyticsFeedbacksResult,
  type AnalyticsFilterOption,
  type AnalyticsMetricSource,
  type AnalyticsReadInput,
  type AnalyticsService,
  type AnalyticsTimeseriesInput,
  type AnalyticsTimeseriesReadOptions,
  type AnalyticsTimeseriesResult,
  type AnalyticsTopDocumentsResult,
  type LangWatchQLCaller,
  type LangWatchQLExecuteInput,
  type LangWatchQLKeyReach,
  type LangWatchQLProtections,
  type LangWatchQLQueryResult,
  type LangWatchQLRunCaller,
  type LangWatchQLAcceptedStatement,
  type LangWatchQLAppFunctionCall,
  type LangWatchQLJudgementCall,
  type LangWatchQLSchema,
  type LangWatchQLService,
  type LangWatchQLStatementRequest,
  type LangWatchQLTextHydrationInput,
  type LangWatchQLValidationInput,
  type QueryReference,
  type AnalyticsApi as AnalyticsApiContract,
  type AnalyticsEvaluationReadInput,
  type AnalyticsEvaluationRollupAppendBatchInput,
  type AnalyticsEvaluationRollupAppendInput,
  type AnalyticsEvaluationRow,
  type AnalyticsEvaluationUpsertInput,
} from "@langwatch/analytics-contract";
import { DEFAULT_LWQL_RESOURCE_LIMITS } from "@langwatch/analytics-contract/langwatch-ql-limits";
import type { RestCredentialPrincipal } from "@langwatch/api/rest";
import { AuthzApi } from "@langwatch/authz-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { NotFoundError } from "@langwatch/handled-error";
import type { FeatureSetup } from "@langwatch/kernel";
import type { RateLimiter } from "@langwatch/process-stores/members";
import { ProjectApi } from "@langwatch/project-contract";
import { Secret } from "@langwatch/secrets";
import type { Instant } from "@langwatch/time";
import { TraceApi, type Trace, TRACE_FILTER_EXAMPLES } from "@langwatch/trace-contract";

import { AnalyticsAdapter } from "../app/analytics-composition.build.ts";
import { FilterOptionsAdapter } from "../app/filter-options-composition.build.ts";
import { createLangWatchQLService } from "../app/langwatch-ql-composition.build.ts";
import { applyLwqlTargetOverrides, LWQL_CONNECTION_DEFAULTS } from "../langwatch-ql/connection.ts";
import type { AnalyticsRecencyRepository } from "../repositories/analytics-recency.repository.ts";
import type { EvaluationAnalyticsClickHouseClient } from "../repositories/clickhouse/clickhouse.analytics-persistence.repository.ts";
import { ClickHouseAnalyticsRecencyRepository } from "../repositories/clickhouse/clickhouse.analytics-recency.repository.ts";
import { ClickHouseLangWatchQLAppFunctionStoreRepository } from "../repositories/clickhouse/clickhouse.langwatch-ql-app-function-store.repository.ts";
import { ClickHouseLangWatchQLProvisioningRepository } from "../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts";
import type { LangWatchQLAppFunctionStoreRepository } from "../repositories/langwatch-ql-app-function-store.repository.ts";
import type { LangWatchQLConnection } from "../repositories/langwatch-ql-executor.repository.ts";
import type { ClickHouseAdminStatements } from "../repositories/langwatch-ql-provisioning.repository.ts";
import { savedWorkbenchChartPlatformUrl as savedWorkbenchChartPlatformUrl_ } from "../rules/analytics-platform-url.rules.ts";
import { lwqlHydrationKeyCap } from "../rules/langwatch-ql-app-function-catalog.rules.ts";
import { canProvisionAppFunctions } from "../rules/langwatch-ql-app-function-store.rules.ts";
import type { LwqlAccessModelOwner } from "../rules/langwatch-ql-config-store.rules.ts";
import { statementMightCallEvalFunction } from "../rules/langwatch-ql-eval-function-catalog.rules.ts";
import { langWatchQLJudgementCalls } from "../rules/langwatch-ql-judgement-questions.rules.ts";
import { instantEvalsEnabled, lwqlEnabled } from "../rules/lwql-access.rules.ts";
import { buildQueryReference } from "../rules/query-reference.rules.ts";
import {
  resolveApiKeyProtections as resolveApiKeyProtectionsRule,
  resolveProjectProtections as resolveProjectProtectionsRule,
  resolveWorkbenchProtections,
  resolveWorkbenchRunCaller,
} from "../rules/workbench-protections.rules.ts";
import { CustomChartPlaygroundAccessService } from "../services/custom-chart-playground-access.service.ts";
import { LangWatchQLBoundsService } from "../services/langwatch-ql-bounds.service.ts";
import { DEFAULT_LWQL_RESULT_LIMITS } from "../services/langwatch-ql-executor.service.ts";
import { LangWatchQLHydrationComputeService } from "../services/langwatch-ql-hydration-compute.service.ts";
import {
  LangWatchQLHydrationReadService,
  type LangWatchQLTraceSource,
} from "../services/langwatch-ql-hydration-read.service.ts";
import { LangWatchQLHydrationService } from "../services/langwatch-ql-hydration.service.ts";
import { LangWatchQLProductionProvisioningService } from "../services/langwatch-ql-production-provisioning.service.ts";
import {
  LangWatchQLQueryScopeService,
  type LangWatchQLQueryScope,
} from "../services/langwatch-ql-query-scope.service.ts";
import {
  convergeLwqlAccessModel,
  type LwqlProvisioningDatabase,
} from "../tasks/lwql-provision.task.ts";
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
  /** The peer every app-function value is read and rendered through. */
  traces: TraceApi;
  /** Where the server would keep the app functions, for the checkup's provisioning probe. */
  appFunctionStore: LangWatchQLAppFunctionStoreRepository;
  /** The newest slim-table row per source, which the graph-alert heartbeat reads. */
  recency: AnalyticsRecencyRepository;
  /** The access model's owner probe and convergence; no-ops where LangWatchQL is unavailable. */
  lwqlProvisioning: LwqlProvisioningOperations;
}

export type AnalyticsInfrastructure = Readonly<{
  resolveClickHouseClient: ((tenantId: string) => Promise<ClickHouseClient | null>) | null;
  clickhouseEnabled?: boolean;
  defaultRetentionDays?: () => number;
}>;

/** The peer modules the Workbench's access rules read, resolved through their own tokens. */
type AnalyticsDependencies = Readonly<{
  featureFlags: typeof FeatureFlagApi;
  authz: typeof AuthzApi;
  dataPrivacy: typeof DataPrivacyApi;
  projects: typeof ProjectApi;
  /** The plan the LangWatchQL execution window resolves through. */
  plans: typeof EntitlementApi;
  /** Every app-function value is one of this peer's traces, rendered by it. */
  traces: typeof TraceApi;
  /** The owner of the platform retention default an evaluation row is stamped with. */
  retention: typeof DataRetentionApi;
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
  langwatchQl: LangWatchQlSupply;
}>;

/**
 * Whether this deployment offers LangWatchQL, answered by the process (ADR-159): the
 * credential-free ClickHouse target and identity, plus what self-provisioning reads.
 */
export type LangWatchQlSupply = Readonly<{
  /** The stores' untenanted ClickHouse seam and credential-free target (ADR-159). */
  admin: Readonly<
    | { configured: false }
    | {
        configured: true;
        target: Readonly<{ url: string; database: string }>;
        statements: ClickHouseAdminStatements;
      }
  >;
  /** The PostgreSQL endpoint the named collection dials, without credentials. */
  postgres: Readonly<
    | { configured: false }
    | {
        configured: true;
        host: string;
        port: number;
        database: string;
        schema: string;
        connectionLimit?: number;
      }
  >;
  database: () => LwqlProvisioningDatabase;
}>;

export type LwqlProvisioningOperations = Readonly<{
  probeOwner: () => Promise<LwqlAccessModelOwner>;
  converge: () => Promise<void>;
}>;

const LWQL_UNAVAILABLE: LwqlProvisioningOperations = {
  probeOwner: () => Promise.resolve("none"),
  converge: () => Promise.resolve(),
};

/** The reconvergence watch's two operations over the stores' admin seam (ADR-159). */
function lwqlProvisioningOperations({
  admin,
  postgres,
  database,
  connection,
  readerPassword,
  settings,
}: {
  admin: Extract<LangWatchQlSupply["admin"], { configured: true }>;
  postgres: Extract<LangWatchQlSupply["postgres"], { configured: true }>;
  database: LangWatchQlSupply["database"];
  connection: LangWatchQLConnection;
  readerPassword: string | undefined;
  settings: AnalyticsServerConfig["langwatchQl"];
}): LwqlProvisioningOperations {
  const names = LangWatchQLProductionProvisioningService.create().names({ connection });
  const openRepository = () =>
    ClickHouseLangWatchQLProvisioningRepository.create({ statements: admin.statements });
  return {
    probeOwner: () => openRepository().probeOwner({ names }),
    converge: async () => {
      // Main arms the watch only in SQL mode; a config store owns the rest.
      if (settings.accessModelMode !== "sql" || readerPassword === undefined) return;
      await convergeLwqlAccessModel({
        database: database(),
        plan: {
          request: {
            requested: true,
            complete: true,
            connection,
            postgresReaderPassword: readerPassword,
            endpoint: { host: postgres.host, port: postgres.port, database: postgres.database },
          },
          names,
          sourceDatabase: () => admin.target.database,
          schema: postgres.schema,
          ...(postgres.connectionLimit === undefined
            ? {}
            : { connectionLimit: postgres.connectionLimit }),
          settings: {
            LWQL_ACCESS_MODEL_MODE: settings.accessModelMode,
            LWQL_ACCESS_MODEL_SQL_SINGLE_NODE: settings.sqlSingleNode,
          },
          openRepository,
        },
      });
    },
  };
}

type AnalyticsSetup = FeatureSetup<AnalyticsDependencies, AnalyticsMembers, AnalyticsServerConfig>;

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
 * The two reads hydration makes, in the Trace peer's own vocabulary: it names
 * traces and threads where hydration names keys.
 */
class TraceApiHydrationSource implements LangWatchQLTraceSource {
  constructor(private readonly traces: TraceApi) {}

  readTraces({
    projectId,
    traceIds,
    protections,
  }: Parameters<LangWatchQLTraceSource["readTraces"]>[0]): Promise<readonly Trace[]> {
    return this.traces.readTracesWithSpans({ projectId, traceIds: [...traceIds], protections });
  }

  readThreadTraces({
    projectId,
    threadKeys,
    protections,
    maxTraces,
  }: Parameters<LangWatchQLTraceSource["readThreadTraces"]>[0]): Promise<readonly Trace[]> {
    return this.traces.readThreadsTraces({
      projectId,
      threadIds: [...threadKeys],
      protections,
      maxTraces,
    });
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
    /** Every app-function value is one of this peer's traces, rendered by it. */
    traces: TraceApi,
    retention: DataRetentionApi,
  };
  /**
   * `rateLimiter` is the per-project counter every LangWatchQL execution is
   * checked against. All three names are from the process's vocabulary; boot
   * refuses by name.
   */
  static readonly config = analyticsServerConfig;
  static readonly reads = ["clickhouse", "rateLimiter", "publicBaseUrl", "langwatchQl"] as const;
  /** The restricted identity's password and the PostgreSQL reader's (ADR-132). */
  static readonly secrets = {
    lwqlClickHousePassword: Secret.load("LWQL_CLICKHOUSE_PASSWORD", { optional: true }),
    lwqlPostgresReaderPassword: Secret.load("LWQL_POSTGRES_READER_PASSWORD", { optional: true }),
  } as const;

  static async create(setup: AnalyticsSetup): Promise<AnalyticsApp> {
    const clickhouse = setup.members.clickhouse;
    const resolveClient = (tenantId: string): Promise<EvaluationAnalyticsClickHouseClient> =>
      Promise.resolve(new ClickHouseMemberSession(clickhouse, tenantId));
    const analytics = AnalyticsAdapter.create({
      resolveClient,
      // The member is a `reads("clickhouse")` claim: boot refuses this
      // process before `create()` runs if no ClickHouse was configured, so by
      // the time this constructs, ClickHouse is always available.
      clickhouseEnabled: true,
      // Data retention owns `LANGWATCH_DEFAULT_RETENTION_DAYS`; a second claim
      // on it refuses the whole process, and two defaults expire rows.
      defaultRetentionDays: () => setup.dependencies.retention.getPlatformDefaultRetentionDays(),
    });
    const lwqlConfig = setup.config.langwatchQl;
    const { admin, postgres, database } = setup.members.langwatchQl;
    const target = admin.configured
      ? applyLwqlTargetOverrides({
          target: admin.target,
          explicitUrl: lwqlConfig.url,
          explicitDatabase: lwqlConfig.database,
        })
      : { available: false as const };
    const connection: LangWatchQLConnection | null = target.available
      ? await setup.secrets.into(AnalyticsApp.secrets.lwqlClickHousePassword, (password) =>
          typeof password === "string" && password
            ? {
                url: target.url,
                database: target.database,
                username: lwqlConfig.username ?? LWQL_CONNECTION_DEFAULTS.restrictedUser,
                tenantSetting: lwqlConfig.tenantSetting ?? LWQL_CONNECTION_DEFAULTS.tenantSetting,
                password,
              }
            : null,
        )
      : null;
    const lwqlProvisioning =
      admin.configured && postgres.configured && connection
        ? await setup.secrets.into(
            AnalyticsApp.secrets.lwqlPostgresReaderPassword,
            (readerPassword) =>
              lwqlProvisioningOperations({
                admin,
                postgres,
                database,
                connection,
                readerPassword: typeof readerPassword === "string" ? readerPassword : undefined,
                settings: lwqlConfig,
              }),
          )
        : LWQL_UNAVAILABLE;
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
        traces: setup.dependencies.traces,
        appFunctionStore: ClickHouseLangWatchQLAppFunctionStoreRepository.create(clickhouse),
        recency: ClickHouseAnalyticsRecencyRepository.create(clickhouse),
        lwqlProvisioning,
      },
      setup.members.publicBaseUrl,
    );
  }

  #dependencies: AnalyticsAppDependencies;
  #publicBaseUrl: string | undefined;
  #playgroundAccess: CustomChartPlaygroundAccessService;
  #hydration: LangWatchQLHydrationService;
  #queryScope: LangWatchQLQueryScopeService;

  private constructor(dependencies: AnalyticsAppDependencies, publicBaseUrl: string | undefined) {
    this.#dependencies = dependencies;
    this.#queryScope = LangWatchQLQueryScopeService.create(dependencies);
    this.#publicBaseUrl = publicBaseUrl;
    this.#playgroundAccess = CustomChartPlaygroundAccessService.create(dependencies);
    this.#hydration = LangWatchQLHydrationService.create({
      reads: LangWatchQLHydrationReadService.create({
        traces: new TraceApiHydrationSource(dependencies.traces),
      }),
      compute: LangWatchQLHydrationComputeService.create({ renderer: dependencies.traces }),
      // The statement is run through this same door, so the hydration reaches
      // it late: the bounds and the eval-function gate apply to it too.
      runner: { executeLangWatchQL: (input) => this.executeLangWatchQL(input) },
    });
  }

  /** Who owns the LangWatchQL access model now; the reconvergence watch probes this. */
  probeLwqlAccessModelOwner(): Promise<LwqlAccessModelOwner> {
    return this.#dependencies.lwqlProvisioning.probeOwner();
  }

  /** Re-provisions the access model once a config store released it (SQL mode only). */
  convergeLwqlAccessModel(): Promise<void> {
    return this.#dependencies.lwqlProvisioning.converge();
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

  /** When the project's newest row of one source since `since` occurred; empty when none did. */
  findLastOccurredAt(input: {
    readonly projectId: string;
    readonly source: AnalyticsMetricSource;
    readonly since: Instant;
  }): Promise<Instant[]> {
    return this.#dependencies.recency.findLastOccurredAt(input);
  }

  /** Whether every replica would see the app functions; empty where the server did not say. */
  async findAppFunctionsProvisionable(): Promise<boolean[]> {
    return (await this.#dependencies.appFunctionStore.findProbe()).map(canProvisionAppFunctions);
  }

  /** The database this deployment's LangWatchQL views live in. */
  langWatchQLDatabase(): string {
    return this.#dependencies.langWatchQL.database;
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
   * The SQL half is withheld rather than hidden from a caller that cannot run
   * it — `/schema` refuses such a key — while the filter half is answered in
   * full either way. See ADR-154.
   */
  describeQueryReference(
    input: Readonly<{
      projectId: string;
      protections: LangWatchQLProtections;
      canRunLangWatchQL: boolean;
    }>,
  ): Promise<QueryReference> {
    return this.#queryReference({
      protections: input.protections,
      canRunLangWatchQL: input.canRunLangWatchQL,
      schema: () =>
        this.describeLangWatchQLSchema({
          projectId: input.projectId,
          protections: input.protections,
        }),
    });
  }

  /**
   * One statement over every project this key may read, counted against each of their
   * windows first. An empty scope still runs, and reads zero rows.
   */
  async runLangWatchQLForKey(
    input: Readonly<{ reach: LangWatchQLKeyReach } & LangWatchQLStatementRequest>,
  ): Promise<LangWatchQLQueryResult> {
    const { reach, sql, parameters, timeWindow, granularitySeconds } = input;
    const { projects, protections } = await this.#queryScope.resolve({ reach });
    for (const project of projects) {
      await this.#dependencies.lwqlBounds.assertQueryWithinBounds({ projectId: project.id });
    }

    return this.#dependencies.langWatchQL.executeForProjects({
      projects,
      protections,
      sql,
      ...(parameters ? { parameters } : {}),
      ...(timeWindow ? { timeWindow } : {}),
      ...(granularitySeconds === undefined ? {} : { granularitySeconds }),
      isInstantEvalsEnabled:
        statementMightCallEvalFunction(sql) && (await this.#isInstantEvalsEnabledFor({ projects })),
    });
  }

  /** The catalogue as this key sees it: gated to the strictest of its readable projects. */
  async describeLangWatchQLSchemaForKey(
    input: Readonly<{ reach: LangWatchQLKeyReach }>,
  ): Promise<LangWatchQLSchema> {
    return this.#schemaFor(await this.#queryScope.resolve(input));
  }

  /**
   * Both query languages, the SQL half open when the key clears `analytics:view` where it
   * resolved AND reads at least one project; saying so points any other key at the filter.
   */
  async describeQueryReferenceForKey(
    input: Readonly<{ reach: LangWatchQLKeyReach }>,
  ): Promise<QueryReference> {
    const scope = await this.#queryScope.resolve(input);
    const holdsQueryPermission = await this.#queryScope.holdsQueryPermission(input);

    return this.#queryReference({
      protections: scope.protections,
      canRunLangWatchQL: holdsQueryPermission && scope.projects.length > 0,
      schema: () => this.#schemaFor(scope),
    });
  }

  async #schemaFor(scope: LangWatchQLQueryScope): Promise<LangWatchQLSchema> {
    return this.#dependencies.langWatchQL.describeSchema({
      protections: scope.protections,
      isInstantEvalsEnabled: await this.#isInstantEvalsEnabledFor(scope),
    });
  }

  /** A judged column is charged to one project, so the gate opens only for a scope of one. */
  async #isInstantEvalsEnabledFor(
    scope: Pick<LangWatchQLQueryScope, "projects">,
  ): Promise<boolean> {
    const [sole, ...others] = scope.projects;
    if (!sole || others.length > 0) return false;

    return this.#isInstantEvalsEnabled(sole.id);
  }

  async #queryReference(
    input: Readonly<{
      protections: LangWatchQLProtections;
      canRunLangWatchQL: boolean;
      schema: () => Promise<LangWatchQLSchema>;
    }>,
  ): Promise<QueryReference> {
    const database = this.langWatchQLDatabase();

    return buildQueryReference({
      protections: input.protections,
      lwqlEnabled: input.canRunLangWatchQL,
      database,
      schema: input.canRunLangWatchQL
        ? await input.schema()
        : { database, functions: [], views: [], appFunctions: [] },
      limits: {
        maxStatementLength: MAX_LWQL_LENGTH,
        maxRowsReturned: DEFAULT_LWQL_RESULT_LIMITS.maxRows,
        maxResultBytes: DEFAULT_LWQL_RESULT_LIMITS.maxResultBytes,
        maxExecutionTimeSeconds: DEFAULT_LWQL_RESOURCE_LIMITS.maxExecutionTimeSeconds,
      },
      traceFilterExamples: TRACE_FILTER_EXAMPLES,
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

  upsertEvaluationAnalytics(input: AnalyticsEvaluationUpsertInput): Promise<void> {
    return this.#dependencies.analytics.upsertEvaluationAnalytics(input);
  }

  upsertEvaluationAnalyticsBatch(input: AnalyticsEvaluationUpsertInput[]): Promise<void> {
    return this.#dependencies.analytics.upsertEvaluationAnalyticsBatch(input);
  }

  findEvaluationAnalytics(
    input: AnalyticsEvaluationReadInput,
  ): Promise<{ row: AnalyticsEvaluationRow; appliedEventIds: string[] } | null> {
    return this.#dependencies.analytics.findEvaluationAnalytics(input);
  }

  appendEvaluationAnalyticsRollup(input: AnalyticsEvaluationRollupAppendInput): Promise<void> {
    return this.#dependencies.analytics.appendEvaluationAnalyticsRollup(input);
  }

  appendEvaluationAnalyticsRollupBatch(
    input: AnalyticsEvaluationRollupAppendBatchInput,
  ): Promise<void> {
    return this.#dependencies.analytics.appendEvaluationAnalyticsRollupBatch(input);
  }

  /**
   * The extraction half of a judged plan: the same rows with every judged
   * column holding the text rather than a verdict. No judge is called, so
   * reading what a run would judge never costs what judging it costs.
   */
  hydrateLangWatchQLTexts(
    input: LangWatchQLTextHydrationInput,
  ): Promise<readonly Record<string, unknown>[]> {
    return this.#hydration.hydrateTexts(input);
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
   * What the PROJECT itself may read, with nobody asking — the protections a
   * worker judging that project's own rows runs under, where there is neither
   * a session nor a credential to resolve.
   */
  resolveProjectProtections(
    input: Readonly<{ projectId: string }>,
  ): Promise<LangWatchQLProtections> {
    return resolveProjectProtectionsRule({
      dataPrivacy: this.#dependencies.dataPrivacy,
      projectId: input.projectId,
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
