import type { Query } from "@tanstack/react-query";
import { useCallback } from "react";

import { api } from "../../utils/api";

/** The queries a Retry refetches: on screen and failed. */
export const FAILED_ACTIVE_QUERIES = {
  type: "active" as const,
  predicate: (query: Pick<Query, "state">) => query.state.status === "error",
};

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
    void utils.analytics.getTimeseries.refetch(
      undefined,
      FAILED_ACTIVE_QUERIES,
    );
    void utils.analytics.topUsedDocuments.refetch(
      undefined,
      FAILED_ACTIVE_QUERIES,
    );
    void utils.analytics.feedbacks.refetch(undefined, FAILED_ACTIVE_QUERIES);
  }, [utils]);
}
