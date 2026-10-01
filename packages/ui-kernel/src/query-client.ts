/**
 * The browser's one `QueryClient`. Mutations auto-report through
 * `showErrorToast`; queries do not — a query failure already renders
 * inline, and auto-reporting a background refetch would double it.
 */

import { trpcQueryKey } from "@langwatch/api/web";
import { PERSISTED_QUERY_MAX_AGE, type UiCachePlan } from "@langwatch/browser-host/cache-tiers";
import { showErrorToast } from "@langwatch/browser-host/errors";
import { shouldRetryQuery } from "@langwatch/browser-host/query-retry";
import { isForbiddenAnswer } from "@langwatch/browser-host/session-version";
import {
  focusManager,
  hashKey,
  MutationCache,
  QueryCache,
  QueryClient,
} from "@tanstack/react-query";

let focusGateInstalled = false;

/**
 * Only a visible tab whose window holds focus counts as focused, so a hidden tab
 * runs no interval and refetches nothing. Until the first event the library's
 * own visibility check answers.
 */
function installFocusGate(): void {
  if (focusGateInstalled || typeof document === "undefined") return;
  focusGateInstalled = true;
  focusManager.setEventListener((handleFocus) => {
    const sync = () => handleFocus(document.visibilityState !== "hidden" && document.hasFocus());
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
    };
  });
}

export type UiQueryClientOptions = {
  /**
   * Called once per failed mutation; defaults to `showErrorToast`. Queries
   * carry no equivalent hook — deliberate, see the file docblock.
   */
  onMutationError?: (error: unknown) => void;
  /** The declared cache policies; a persisted read is kept in memory as long as its mirror. */
  cachePlan?: UiCachePlan;
  /**
   * The session read's key. When set, any other read failing 403 refetches the
   * session once (never more while it is already fetching); nothing else is
   * invalidated. browser-query-caching.feature.
   */
  sessionQueryKey?: readonly unknown[];
};

/**
 * Builds one `QueryClient`. Compose this rather than constructing
 * `new QueryClient()` by hand — the retry policy and the mutation reporter
 * are the browser's, not a call site's, to choose.
 */
export function createUiQueryClient({
  onMutationError = defaultMutationErrorReporter,
  cachePlan,
  sessionQueryKey,
}: UiQueryClientOptions = {}): QueryClient {
  installFocusGate();
  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      // A read is trusted for 5 minutes, then refetched on focus (the focused tab only) or
      // reconnect; a read hint refetches it sooner. Nothing polls. read-hints.feature.
      queries: {
        retry: shouldRetryQuery,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchIntervalInBackground: false,
      },
    },
    mutationCache: new MutationCache({ onError: onMutationError }),
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (!sessionQueryKey || !isForbiddenAnswer(error)) return;
        if (query.queryHash === hashKey(sessionQueryKey)) return;
        if (queryClient.isFetching({ queryKey: sessionQueryKey, exact: true }) > 0) return;
        void queryClient.refetchQueries({ queryKey: sessionQueryKey, exact: true });
      },
    }),
  });
  for (const path of cachePlan?.persisted ?? []) {
    queryClient.setQueryDefaults(trpcQueryKey(path), { gcTime: PERSISTED_QUERY_MAX_AGE });
  }

  return queryClient;
}

function defaultMutationErrorReporter(error: unknown): void {
  showErrorToast({ error });
}
