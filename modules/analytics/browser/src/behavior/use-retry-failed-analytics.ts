import type { Query } from "@tanstack/react-query";
import { useCallback } from "react";

import { analyticsApi } from "./analytics-api.ts";

/** The queries a Retry refetches: on screen and failed. */
export const FAILED_ACTIVE_QUERIES = {
  type: "active" as const,
  predicate: (query: Pick<Query, "state">) => query.state.status === "error",
};

/**
 * Retries every analytics panel on screen whose query failed. Panels on a page fail together
 * (one set of filters drives them), and a summary in a tab header cannot hold a button of its
 * own, so any panel's Retry refetches all failed panels. Queries that loaded are left alone.
 */
export function useRetryFailedAnalytics(): () => void {
  const utils = analyticsApi.useUtils();

  return useCallback(() => {
    void utils.analytics.getTimeseries.refetch(undefined, FAILED_ACTIVE_QUERIES);
    void utils.analytics.topUsedDocuments.refetch(undefined, FAILED_ACTIVE_QUERIES);
    void utils.analytics.feedbacks.refetch(undefined, FAILED_ACTIVE_QUERIES);
  }, [utils]);
}
