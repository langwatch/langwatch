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
 */
export function useTopUsedDocuments(params?: TopUsedDocumentsParams) {
  const own = useFilterParams();
  const { filterParams, queryOpts } = params ?? own;
  return api.analytics.topUsedDocuments.useQuery(filterParams, queryOpts);
}
