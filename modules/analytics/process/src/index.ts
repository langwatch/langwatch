export { AnalyticsAdapter } from "./app/analytics-composition.build.ts";
export {
  analyticsServer,
  type AnalyticsClickHouseClientResolver,
  type AnalyticsServiceCompositionInput,
  type ClickHouseFilterConditions,
  createAnalyticsComparisonWindow,
  createAnalyticsService,
  createClickHouseFilterConditions,
  createLegacyFilterMatching,
  createPreconditionTraceData,
  langWatchQlSupply,
} from "./analytics.server.ts";

/** The transport declarations a process mounts, and the doors they open on. */
export {
  analyticsTimeseriesResponseSchema,
  analyticsTimeseriesRestBodySchema,
} from "@langwatch/analytics-contract";
export { analyticsRest } from "./transport/analytics.rest.ts";
export { analyticsLegacyRest } from "./transport/analytics-legacy.rest.ts";
export { type AnalyticsQueryApi, queryRest } from "./transport/query.rest.ts";
export { analyticsTrpcTransport } from "./transport/analytics.trpc.ts";
export {
  type AnalyticsLwqlApi,
  analyticsLwqlTrpcTransport,
} from "./transport/analytics-lwql.trpc.ts";
export type {
  AnalyticsInfrastructure,
  AnalyticsAppDependencies,
  AnalyticsFilterOptionsLookup,
  AnalyticsFilterOptionsRequest,
} from "./app/analytics.app.ts";

/**
 * Filter matching without a query engine: the legacy `filters` grammar
 * decided in memory, published because a settled automation match is
 * re-checked in a background process with no ClickHouse round trip to spend.
 */
export { LegacyFilterMatchingService } from "./services/legacy-filter-matching.service.ts";
export { PreconditionTraceDataService } from "./services/precondition-trace-data.service.ts";

/**
 * The LangWatchQL workbench: the refusals a caller can act on, and the shapes
 * its dependencies are named by. The services themselves stay private to this
 * package and are reached through the composition seam above.
 */
export type { LangWatchQLServiceDependencies } from "./services/langwatch-ql.service.ts";
export {
  LangWatchQLNotEnabledError,
  LangWatchQLParameterMissingError,
  LangWatchQLUnavailableError,
} from "@langwatch/analytics-contract";
export type {
  LangWatchQLConnection,
  LangWatchQLExecutor,
  LangWatchQLResultLimits,
} from "./repositories/langwatch-ql-executor.repository.ts";

/** The filter picker: the values one field can offer. */
export type { GetFilterOptionsInput } from "./services/filter.service.ts";
export type {
  FilterOption,
  FindFilterOptionsInput,
} from "./repositories/filter-options.repository.ts";

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

/** The four ClickHouse query refusals a caller can act on. */
export {
  ClickHouseUnavailableError,
  QueryMemoryExceededError,
  QueryScanLimitExceededError,
  QueryTimeoutError,
} from "@langwatch/analytics-contract";
export { generateClickHouseFilterConditions } from "./rules/analytics-filter-conditions.rules.ts";

// The LangWatchQL key map: the names a project's access is granted through,
// and the rows the deploy backfill repairs.
export type { LangWatchQLNames } from "./services/langwatch-ql-access-model.service.ts";
export type {
  LwqlKeyMapBackfillPlan,
  LwqlKeyMapRow,
} from "./services/langwatch-ql-production-provisioning.service.ts";

export { LwqlProvisionTask } from "./tasks/lwql-provision.task.ts";
export { LwqlRenderAccessConfigTask } from "./tasks/lwql-render-access-config.task.ts";
