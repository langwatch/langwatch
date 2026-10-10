import { analyticsApi } from "./analytics-api.ts";
import { useFilterParams } from "./use-filter-params.ts";

/**
 * The window and filters a documents panel queries with. The documents section passes its own
 * to its panels so all read one cached query: each `useFilterParams` anchors a relative window
 * to its own `now`, so separate calls would send requests with end dates milliseconds apart.
 */
export type TopUsedDocumentsParams = Pick<
  ReturnType<typeof useFilterParams>,
  "filterParams" | "queryOpts"
>;

/** The most-used knowledge-base documents under the caller's window, or the current filters. */
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
