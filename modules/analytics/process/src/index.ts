export { analyticsProcessModule, createAnalyticsComparisonWindow } from "./analytics.module.ts";

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

export {
  LangWatchQLNotEnabledError,
  LangWatchQLParameterMissingError,
  LangWatchQLUnavailableError,
} from "@langwatch/analytics-contract";

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

export { LwqlProvisionTask } from "./tasks/lwql-provision.task.ts";
export { LwqlRenderAccessConfigTask } from "./tasks/lwql-render-access-config.task.ts";
