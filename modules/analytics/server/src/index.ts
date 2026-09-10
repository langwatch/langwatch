export { AnalyticsAdapter } from "./services/analytics-composition.service.ts";
export { analyticsServer } from "./analytics.server.ts";

/** The transport declarations a process mounts, and the doors they open on. */
export {
  analyticsRest,
  analyticsTimeseriesResponseSchema,
  analyticsTimeseriesRestBodySchema,
} from "./transport/analytics.rest.ts";
export { analyticsLegacyRest } from "./transport/analytics-legacy.rest.ts";
export {
  AnalyticsQueryApi,
  langWatchQLCallerProtections,
  queryRest,
} from "./transport/query.rest.ts";
export {
  SavedWorkbenchChartApi,
  savedWorkbenchChartRest,
  savedWorkbenchChartUrl,
} from "./transport/saved-workbench-chart.rest.ts";
export { analyticsTrpcTransport } from "./transport/analytics.trpc.ts";
export { AnalyticsLwqlApi, analyticsLwqlTrpcTransport } from "./transport/analytics-lwql.trpc.ts";
export {
  AnalyticsApp,
  type AnalyticsInfrastructure,
  type AnalyticsAppDependencies,
  type AnalyticsFilterOptionsLookup,
  type AnalyticsFilterOptionsRequest,
} from "./app/analytics.app.ts";
export { LoggingAnalyticsTripwireService } from "./services/analytics-tripwire.service.ts";

/**
 * Filter matching without a query engine: the legacy `filters` grammar
 * decided in memory, published because a settled automation match is
 * re-checked in a background process with no ClickHouse round trip to spend.
 */
export { LegacyFilterMatchingService } from "./services/legacy-filter-matching.service.ts";
export { PreconditionTraceDataService } from "./services/precondition-trace-data.service.ts";
export { ANALYTICS_CLICKHOUSE_SETTINGS } from "./rules/clickhouse-settings.rules.ts";

/**
 * The LangWatchQL workbench: its restricted-identity service, rollout gate,
 * schemas, and statement ceiling — moved here so a process composes it from
 * one package rather than from six platform paths.
 */
export { LangWatchQLAdapter } from "./services/langwatch-ql-composition.service.ts";
export {
  DEFAULT_LWQL_DATABASE,
  LangWatchQLService,
  type LangWatchQLServiceDependencies,
} from "./services/langwatch-ql.service.ts";
export { lwqlEnabled, LWQL_FLAG } from "./rules/lwql-access.rules.ts";
export { LangWatchQLCapabilityService } from "./services/langwatch-ql-capability.service.ts";
export {
  LangWatchQLNotEnabledError,
  LangWatchQLParameterMissingError,
  LangWatchQLUnavailableError,
} from "@langwatch/analytics-contract";
export {
  DEFAULT_LWQL_RESULT_LIMITS,
  LangWatchQLExecutorService,
} from "./services/langwatch-ql-executor.service.ts";
export {
  type LangWatchQLConnection,
  LangWatchQLExecutor,
  type LangWatchQLResultLimits,
} from "./repositories/langwatch-ql-executor.repository.ts";
export { ClickHouseLangWatchQLExecutorAdapter } from "./repositories/clickhouse/clickhouse.langwatch-ql-executor.repository.ts";

/**
 * The filter picker: the values one field can offer, and the two facts a door
 * refuses on before it asks for them.
 */
export { FilterOptionsAdapter } from "./services/filter-options-composition.service.ts";
export { FilterService, type GetFilterOptionsInput } from "./services/filter.service.ts";
export { FilterOptions, type FindFilterOptionsInput } from "./repositories/filter-options.repository.ts";
export type { FilterOption } from "./repositories/filter-options.repository.ts";
export {
  filterFieldRequiresKey,
  filterFieldRequiresSubkey,
} from "./rules/analytics-filter-catalogue.rules.ts";

/** The shared analytics read input every charted door and the REST body parse. */
export {
  isZeroWhenAbsentSeries,
  seriesInputSchema,
  sharedFiltersInputSchema,
  timeseriesInputSchema,
  type SeriesInput,
  type SharedFiltersInput,
  type TimeseriesInput,
  type TracesPivotFilters,
} from "@langwatch/analytics-contract";
export { AnalyticsComparisonWindowService } from "./services/analytics-comparison-window.service.ts";

/** The four ClickHouse query refusals a caller can act on. */
export {
  ClickHouseUnavailableError,
  QueryMemoryExceededError,
  QueryScanLimitExceededError,
  QueryTimeoutError,
} from "@langwatch/analytics-contract";
export { generateClickHouseFilterConditions } from "./rules/analytics-filter-conditions.rules.ts";

// The LangWatchQL key map: the row a project's access is granted by, written at
// project creation and repaired by the deploy backfill.
export {
  LwqlKeyMapErrorSink,
  LwqlKeyMapService,
} from "./services/langwatch-ql-key-map.service.ts";
export { LwqlKeyMapClickHouseRepository } from "./repositories/clickhouse/clickhouse.langwatch-ql-key-map.repository.ts";

// The production provisioning statements and names the deploy task runs. Kept
// beside the runtime reader deliberately: the views a query reads and the
// statements that create them are one description of the same objects.
export {
  KEY_MAP_COLUMNS,
  type LangWatchQLNames,
} from "./services/langwatch-ql-access-model.service.ts";
export {
  type LwqlKeyMapBackfillPlan,
  type LwqlKeyMapRow,
  LangWatchQLProductionProvisioningService,
} from "./services/langwatch-ql-production-provisioning.service.ts";

export { LwqlProvisionTask } from "./tasks/lwql-provision.task.ts";
