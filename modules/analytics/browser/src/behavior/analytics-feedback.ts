/**
 * What the analytics family does about a failure: report it through the host port (the
 * composition's registry writes the words and the toast carries the trace id), and retry
 * the failed panels on screen.
 */

import type { Query } from "@tanstack/react-query";
import { useCallback } from "react";

import { useAnalyticsHost } from "../model/analytics-host.ts";
import { analyticsApi } from "./analytics-api.ts";

export type AnalyticsErrorToastOptions = {
  error: unknown;
  /** Names the action that failed, for a code the host cannot say more about. */
  fallbackTitle?: string;
  id?: string;
};

export function useShowErrorToast(): (options: AnalyticsErrorToastOptions) => void {
  const host = useAnalyticsHost();
  return useCallback(
    ({ error, fallbackTitle, id }: AnalyticsErrorToastOptions) =>
      host.failed({
        error,
        fallbackTitle: fallbackTitle ?? "Something went wrong",
        ...(id ? { id } : {}),
      }),
    [host],
  );
}

/** The queries a Retry refetches: on screen and failed. */
export const FAILED_ACTIVE_QUERIES = {
  type: "active" as const,
  predicate: (query: Pick<Query, "state">) => query.state.status === "error",
};

/**
 * Retries every analytics panel on screen whose query failed. Panels on a page fail together
 * (same filters and window), and a summary in a tab header cannot hold a Retry button of its
 * own, so a Retry in any panel body refetches all failed panels. Loaded ones are left alone.
 */
export function useRetryFailedAnalytics(): () => void {
  const utils = analyticsApi.useUtils();

  return useCallback(() => {
    void utils.analytics.getTimeseries.refetch(undefined, FAILED_ACTIVE_QUERIES);
    void utils.analytics.topUsedDocuments.refetch(undefined, FAILED_ACTIVE_QUERIES);
    void utils.analytics.feedbacks.refetch(undefined, FAILED_ACTIVE_QUERIES);
  }, [utils]);
}
