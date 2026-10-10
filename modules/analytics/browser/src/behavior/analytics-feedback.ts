/**
 * Reports a failure through the host port instead of the application's toast
 * singleton, so the composition's code-keyed presentation registry writes the
 * customer-facing words and the toast carries the trace id.
 */

import { useCallback } from "react";

import { useAnalyticsHost } from "../model/analytics-host.ts";

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
