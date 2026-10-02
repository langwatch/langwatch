import { analyticsApi } from "./analytics-api.ts";
import { useFilterParams } from "./use-filter-params.ts";

/** The most-used knowledge-base documents under the current filters. */
export function useTopUsedDocuments() {
  const { filterParams, queryOpts } = useFilterParams();
  return analyticsApi.analytics.topUsedDocuments.useQuery(filterParams, queryOpts);
}

/** The feedback rows under the current filters. */
export function useAnalyticsFeedbacks() {
  const { filterParams, queryOpts } = useFilterParams();
  return analyticsApi.analytics.feedbacks.useQuery(filterParams, queryOpts);
}
