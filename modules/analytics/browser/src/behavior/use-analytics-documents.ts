import { analyticsApi } from "./analytics-api.ts";
import { useFilterParams } from "./use-filter-params.ts";

/**
 * The window and filters a documents panel queries with. The section passes its own down so
 * its panels share one cached query: each `useFilterParams` call anchors a relative window
 * to its own `now`, so panels calling it each would send end dates milliseconds apart.
 */
export type TopUsedDocumentsParams = Pick<
  ReturnType<typeof useFilterParams>,
  "filterParams" | "queryOpts"
>;

/**
 * The most-used knowledge-base documents under the current filters, read from
 * the caller's shared window and filters when given, or from its own.
 */
export function useTopUsedDocuments(params?: TopUsedDocumentsParams) {
  const own = useFilterParams();
  const { filterParams, queryOpts } = params ?? own;
  return analyticsApi.analytics.topUsedDocuments.useQuery(filterParams, queryOpts);
}

/** The feedback rows under the current filters. */
export function useAnalyticsFeedbacks() {
  const { filterParams, queryOpts } = useFilterParams();
  return analyticsApi.analytics.feedbacks.useQuery(filterParams, queryOpts);
}
