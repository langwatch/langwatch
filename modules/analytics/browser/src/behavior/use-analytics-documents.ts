import { useRef } from "react";

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
 * The most-used documents under the caller's window and filters, or its own. `failure` keeps
 * the last error while a retry runs (react-query clears `error` then), so the Retry stays up.
 * `retryOnMount` is off so a panel mounting under a failed query sends no request of its own.
 */
export function useTopUsedDocuments(params?: TopUsedDocumentsParams) {
  const own = useFilterParams();
  const { filterParams, queryOpts } = params ?? own;
  const query = analyticsApi.analytics.topUsedDocuments.useQuery(filterParams, {
    ...queryOpts,
    retryOnMount: false,
  });

  const lastError = useRef(query.error);
  if (query.error) lastError.current = query.error;

  const isRetrying =
    !query.error &&
    query.isFetching &&
    query.data === undefined &&
    query.errorUpdateCount > 0 &&
    lastError.current !== null;

  return {
    ...query,
    failure: query.error ?? (isRetrying ? lastError.current : null),
    isRetrying,
  };
}

/** The feedback rows under the current filters. */
export function useAnalyticsFeedbacks() {
  const { filterParams, queryOpts } = useFilterParams();
  return analyticsApi.analytics.feedbacks.useQuery(filterParams, queryOpts);
}
