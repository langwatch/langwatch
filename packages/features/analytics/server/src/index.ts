export { AnalyticsAdapter } from "./adapters/analytics.adapter";
export {
  AnalyticsApp,
  type AnalyticsAppDependencies,
  type AnalyticsFilterOption,
  type AnalyticsFilterOptionsLookup,
  type AnalyticsFilterOptionsRequest,
} from "./app/analytics.app";
export { LoggingAnalyticsTripwire } from "./services/analytics-tripwire.service";

/**
 * Filter matching without a query engine: the legacy `filters` grammar
 * decided in memory, published because a settled automation match is
 * re-checked in a background process with no ClickHouse round trip to spend.
 */
export { LegacyFilterMatchingService } from "./services/legacy-filter-matching.service";
export { PreconditionTraceDataService } from "./services/precondition-trace-data.service";
export { ANALYTICS_CLICKHOUSE_SETTINGS } from "./rules/clickhouse-settings.rules";
export {
  AnalyticsTrpcApi,
  type AnalyticsTrpcContext,
  type AnalyticsTrpcPorts,
} from "./transport/api-trpc/analytics.api";
export {
  LangWatchQLTrpcApi,
  type LangWatchQLTrpcContext,
  type LangWatchQLTrpcPorts,
  type LangWatchQLAvailability,
  type LangWatchQLUnavailableReason,
} from "./transport/api-trpc/langwatch-ql.api";
export {
  createAnalyticsRestApp,
  type AnalyticsTimeseriesRestBody,
} from "./transport/api-rest/analytics.api";
export { createAnalyticsLegacyRestApp } from "./transport/api-rest/analytics-legacy.api";

/**
 * The LangWatchQL workbench: its restricted-identity service, rollout gate,
 * schemas, and statement ceiling — moved here so a process composes it from
 * one package rather than from six platform paths.
 */
export { LangWatchQLAdapter } from "./adapters/langwatch-ql.adapter";
export {
  DEFAULT_LWQL_DATABASE,
  LangWatchQLService,
  type LangWatchQLServiceDependencies,
} from "./services/langwatch-ql.service";
export { lwqlEnabled, LWQL_FLAG } from "./rules/lwql-access.rules";
export { lwqlTenantCapability } from "./services/langwatch-ql-capability.service";
export {
  LangWatchQLNotEnabledError,
  LangWatchQLParameterMissingError,
  LangWatchQLUnavailableError,
} from "@langwatch/analytics-contract";
export {
  createLangWatchQLExecutor,
  DEFAULT_LWQL_RESULT_LIMITS,
  lwqlConnectionFromEnvironment,
  type LangWatchQLConnection,
  type LangWatchQLExecutor,
  type LangWatchQLResultLimits,
} from "./services/langwatch-ql-executor.service";
export { MAX_LWQL_LENGTH } from "./services/langwatch-ql-sql-text.service";
export {
  lwqlGranularityStepSchema,
  lwqlTimeWindowSchema,
} from "./services/langwatch-ql-time-window.service";

/**
 * The filter picker: the values one field can offer, and the two facts a door
 * refuses on before it asks for them.
 */
export { FilterOptionsAdapter } from "./adapters/filter-options.adapter";
export { FilterService, type GetFilterOptionsInput } from "./services/filter.service";
export { FilterOptionsPort, type FindFilterOptionsInput } from "./ports/filter-options.port";
export type { FilterOption } from "./ports/filter-options.port";
export {
  filterFieldRequiresKey,
  filterFieldRequiresSubkey,
} from "./rules/analytics-filter-catalogue.rules";

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
export { currentVsPreviousDates } from "./services/analytics-comparison-window.service";

/** The four ClickHouse query refusals a caller can act on. */
export {
  ClickHouseUnavailableError,
  QueryMemoryExceededError,
  QueryScanLimitExceededError,
  QueryTimeoutError,
} from "@langwatch/analytics-contract";
export { generateClickHouseFilterConditions } from "./adapters/clickhouse.filter-conditions.adapter";

/** The saved-chart REST family. */
export {
  createLangWatchQLRestApp,
  type LangWatchQLRestPorts,
} from "./transport/api-rest/langwatch-ql.api";
/** The one door for raw LangWatchQL: `/api/v1/query`. */
export { createQueryRestApp, registerQueryRoutes } from "./transport/api-rest/query.api";
export type { SavedWorkbenchChartRestService } from "./services/langwatch-ql-route-guards.service";

// The LangWatchQL key map: the row a project's access is granted by, written at
// project creation and repaired by the deploy backfill.
export {
  LwqlKeyMapErrorSinkPort,
  LwqlKeyMapService,
} from "./services/langwatch-ql-key-map.service";

// The production provisioning statements and names the deploy task runs. Kept
// beside the runtime reader deliberately: the views a query reads and the
// statements that create them are one description of the same objects.
export {
  KEY_MAP_COLUMNS,
  type LangWatchQLNames,
} from "./adapters/clickhouse.lwql-provisioning.adapter";
export {
  type LwqlKeyMapBackfillPlan,
  type LwqlKeyMapRow,
  lwqlKeyMapTableQualifiedName,
  lwqlPostgresSchemaFromDatabaseUrl,
  planLwqlKeyMapBackfill,
  productionClickHouseObjectStatements,
  productionLangWatchQLNames,
  productionPostgresApprovedViewStatements,
  productionPostgresReaderGrantStatements,
  withTenancyOptOut,
} from "./services/langwatch-ql-production-provisioning.service";

export { LwqlProvisionTask } from "./tasks/lwql-provision.task";
