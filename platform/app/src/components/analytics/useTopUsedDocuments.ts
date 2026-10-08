import { useRef } from "react";
import { useFilterParams } from "../../hooks/useFilterParams";
import { api } from "../../utils/api";

/**
 * The window and filters a documents panel queries with. The documents
 * section passes its own down to its panels so all of them read one cached
 * query: every `useFilterParams` call anchors a relative window to its own
 * `now`, so panels that each called it would send three requests with end
 * dates a few milliseconds apart.
 */
export type TopUsedDocumentsParams = Pick<
  ReturnType<typeof useFilterParams>,
  "filterParams" | "queryOpts"
>;

/**
 * The most used documents for the analytics window, read from the caller's
 * shared window and filters when given, or from its own `useFilterParams`.
 *
 * `failure` is the error the panels show. It is the query's error, and while
 * a retry of a failed query is in flight it is the last error seen: react-query
 * clears `error` when it refetches a query that has no data, and a section that
 * hid on that would unmount its own Retry mid-retry. `isRetrying` says that
 * retry is in flight.
 *
 * `retryOnMount` is off so a panel mounting under a failed query does not
 * send a request of its own; a failed query is fetched again only by Retry
 * or by a change of window or filters.
 */
export function useTopUsedDocuments(params?: TopUsedDocumentsParams) {
  const own = useFilterParams();
  const { filterParams, queryOpts } = params ?? own;
  const query = api.analytics.topUsedDocuments.useQuery(filterParams, {
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
