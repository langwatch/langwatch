import { useCallback } from "react";

import { api } from "../../utils/api";

/**
 * Retries every analytics panel on screen whose query failed.
 *
 * Panels on one page fail together for one reason (the same filters and time
 * range drive all of them), and a summary drawn inside a tab header cannot
 * hold a Retry button of its own, since a button cannot sit inside a button.
 * So a Retry in any panel body refetches all failed panels, the tab headers
 * included. Queries that loaded are left alone.
 */
export function useRetryFailedAnalytics(): () => void {
  const utils = api.useUtils();

  return useCallback(() => {
    const filters = {
      type: "active" as const,
      predicate: (query: { state: { status: string } }) =>
        query.state.status === "error",
    };
    void utils.analytics.getTimeseries.refetch(undefined, filters);
    void utils.analytics.topUsedDocuments.refetch(undefined, filters);
    void utils.analytics.feedbacks.refetch(undefined, filters);
  }, [utils]);
}
