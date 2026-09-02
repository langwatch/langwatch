export { AnalyticsAdapter } from "./adapters/analytics.adapter";
export {
  AnalyticsApp,
  type AnalyticsAppDependencies,
  type AnalyticsFilterOption,
  type AnalyticsFilterOptionsLookup,
  type AnalyticsFilterOptionsRequest,
} from "./app/analytics.app";
export { LoggingAnalyticsTripwire } from "./services/analytics.tripwire";
export { ANALYTICS_CLICKHOUSE_SETTINGS } from "./clickhouse/settings";
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

/**
 * The LangWatchQL workbench: its restricted-identity service, the rollout gate
 * both of its doors ask through, the schemas a caller's period and step arrive
 * as, and the statement ceiling. Moved here with the service, so a process
 * composes the workbench from one package rather than from six platform paths.
 */
export { LangWatchQLAdapter } from "./adapters/langwatch-ql.adapter";
export {
  DEFAULT_LWQL_DATABASE,
  LangWatchQLService,
  type LangWatchQLServiceDependencies,
} from "./services/langwatch-ql.service";
export { lwqlEnabled, LWQL_FLAG } from "./langwatch-ql/access";
export { lwqlTenantCapability } from "./langwatch-ql/capability";
export {
  LangWatchQLNotEnabledError,
  LangWatchQLParameterMissingError,
  LangWatchQLUnavailableError,
} from "./langwatch-ql/errors";
export {
  createLangWatchQLExecutor,
  DEFAULT_LWQL_RESULT_LIMITS,
  lwqlConnectionFromEnv,
  type LangWatchQLConnection,
  type LangWatchQLExecutor,
  type LangWatchQLResultLimits,
} from "./langwatch-ql/executor";
export { MAX_LWQL_LENGTH } from "./langwatch-ql/sqlText";
export {
  lwqlGranularityStepSchema,
  lwqlTimeWindowSchema,
} from "./langwatch-ql/timeWindowSchema";

/**
 * The filter picker: the values one field can offer, and the two facts a door
 * refuses on before it asks for them.
 */
export { FilterOptionsAdapter } from "./adapters/filter-options.adapter";
export { FilterService, type GetFilterOptionsInput } from "./services/filter.service";
export {
  FilterOptionsRepository,
  type FindFilterOptionsInput,
} from "./ports/filter-options.port";
export type { FilterOption } from "./filters/clickhouse/types";
export {
  filterFieldRequiresKey,
  filterFieldRequiresSubkey,
} from "./model/analytics-filter-catalogue";

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
} from "./model/analytics-input";
export { currentVsPreviousDates } from "./model/current-vs-previous-dates";

/** The four ClickHouse query refusals a caller can act on. */
export {
  ClickHouseUnavailableError,
  QueryMemoryExceededError,
  QueryScanLimitExceededError,
  QueryTimeoutError,
} from "./clickhouse/query-errors";
export { generateClickHouseFilterConditions } from "./filters/clickhouse/filter-conditions";
