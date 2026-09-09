/**
 * The analytics feature's application: what both of its doors call.
 *
 * It holds every service and port the feature needs, and it is the one typed
 * thing a transport is given. Before it, each door declared its own private
 * bag — `Readonly<{ analytics: AnalyticsService; filters: … }>` on the reads
 * door and `Readonly<{ langWatchQL: LangWatchQLService }>` on the workbench
 * door — two descriptions of the same process object, agreeing by attention
 * rather than by construction, and neither reachable from the other.
 *
 * Most operations are the services' own, reached through {@link
 * AnalyticsAppDependencies}. What lives here as a rule is what a door would
 * otherwise have to know: today that is which filters narrow a filter's own
 * offered values, which is a fact about the question being asked rather than
 * about the transport it arrived over.
 *
 * The filter catalogue arrives as a port because which fields exist, and what
 * a stored filter means, is the host's catalogue rather than anything
 * Analytics owns.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
 */
import {
  analyticsServerConfigSchema,
  AnalyticsApi as AnalyticsApiToken,
} from "@langwatch/analytics-contract";
import type {
  AnalyticsFeedbacksResult,
  AnalyticsFilterOption,
  AnalyticsReadInput,
  AnalyticsService,
  AnalyticsTimeseriesInput,
  AnalyticsTimeseriesReadOptions,
  AnalyticsTimeseriesResult,
  AnalyticsTopDocumentsResult,
  LangWatchQLExecuteInput,
  LangWatchQLProtections,
  LangWatchQLQueryResult,
  LangWatchQLSchema,
  LangWatchQLService,
  AnalyticsServerConfig,
  AnalyticsApi as AnalyticsApiContract,
} from "@langwatch/analytics-contract";
import type { ClickHouseClient } from "@clickhouse/client";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { AnalyticsAdapter } from "../adapters/analytics.adapter.ts";
import { FilterOptionsAdapter } from "../adapters/filter-options.adapter.ts";
import { LangWatchQLAdapter } from "../adapters/langwatch-ql.adapter.ts";
import type { LangWatchQLConnection } from "../ports/langwatch-ql-executor.port.ts";

/**
 * The filter-value read this feature makes on the host's filter registry.
 *
 * Declared as the one method it calls: which fields exist, and what a stored
 * filter means, is the host's catalogue rather than anything Analytics owns.
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
}

export type AnalyticsInfrastructure = Readonly<{
  resolveClickHouseClient: ((tenantId: string) => Promise<ClickHouseClient | null>) | null;
  clickhouseEnabled?: boolean;
  defaultRetentionDays?: number;
}>;

type AnalyticsSetup = FeatureSetup<
  Record<never, never>,
  AnalyticsInfrastructure,
  AnalyticsServerConfig
>;

const isPresent = (value: string | undefined): value is string => Boolean(value);

const langWatchQlConnection = (values: readonly string[]): LangWatchQLConnection => {
  const [url, username, password, database, tenantSetting] = values;
  if (!url || !username || !password || !database || !tenantSetting) {
    throw new Error("LangWatchQL connection is incomplete");
  }
  return { url, username, password, database, tenantSetting };
};

export class AnalyticsApp implements AnalyticsApiContract {
  static readonly contract = AnalyticsApiToken;
  static readonly dependencies = {};
  static readonly configSchema = analyticsServerConfigSchema;

  static create(setup: AnalyticsSetup): AnalyticsApp {
    const resolveClient = setup.infrastructure.resolveClickHouseClient;
    const analytics = AnalyticsAdapter.create({
      resolveClient: async (tenantId) => (resolveClient ? resolveClient(tenantId) : null),
      clickhouseEnabled: setup.infrastructure.clickhouseEnabled ?? resolveClient !== null,
      defaultRetentionDays: setup.infrastructure.defaultRetentionDays,
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
    const langWatchQL = LangWatchQLAdapter.create({ connection });
    setup.resources.own("Analytics LangWatchQL identity", () => langWatchQL.close());
    return new AnalyticsApp({
      analytics,
      filterOptions: FilterOptionsAdapter.create({
        resolveClient: resolveClient
          ? async (tenantId) => {
              const client = await resolveClient(tenantId);
              if (!client) throw new Error("ClickHouse client is not available");
              return client;
            }
          : null,
      }),
      langWatchQL,
    });
  }

  #dependencies: AnalyticsAppDependencies;

  private constructor(dependencies: AnalyticsAppDependencies) {
    this.#dependencies = dependencies;
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
   * The values one filter field can offer, narrowed by the OTHER filters
   * already applied.
   *
   * The exclusion is here rather than in the door because it is a fact about
   * the question: the values offered for a field must not already be narrowed
   * by the selection being made on that same field, or the picker can only
   * ever re-offer what is already chosen. A door that forgot it would not
   * fail — it would quietly answer a narrower question.
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
   * Whether this deployment has a LangWatchQL identity to run statements as.
   *
   * A deployment without one can still describe the catalogue, which is why
   * the workbench gates its navigation on this rather than on the schema.
   */
  isLangWatchQLAvailable(): boolean {
    return this.#dependencies.langWatchQL.available;
  }

  /** The datasets and columns one member's protections unlock. */
  describeLangWatchQLSchema(
    input: Readonly<{ protections: LangWatchQLProtections }>,
  ): LangWatchQLSchema {
    return this.#dependencies.langWatchQL.describeSchema(input);
  }

  /**
   * Runs one submitted statement exactly as it was written.
   *
   * Parsing, the default-deny policy, tenant isolation and the resource
   * ceilings are the service's; nothing here second-guesses them, because a
   * second opinion could only ever disagree.
   */
  executeLangWatchQL(input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult> {
    return this.#dependencies.langWatchQL.execute(input);
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

  tryGetEvaluationAnalytics(
    input: Parameters<AnalyticsService["tryGetEvaluationAnalytics"]>[0],
  ): ReturnType<AnalyticsService["tryGetEvaluationAnalytics"]> {
    return this.#dependencies.analytics.tryGetEvaluationAnalytics(input);
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

  validateLangWatchQL(input: Parameters<LangWatchQLService["validate"]>[0]): unknown {
    return this.#dependencies.langWatchQL.validate(input);
  }
}
