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
  hashKey,
  MutationCache,
  QueryCache,
  QueryClient,
  type Query,
} from "@tanstack/react-query";

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
  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      // A read is trusted for 5 minutes, then refetched when the tab is shown or reconnects; a read
      // hint refetches it sooner. "Focused" is the library's default: the tab is visible, whatever
      // the window focus. Query-sync owns the one pass on showing, so the library's is off.
      // ARCHITECTURE.md §10.2, read-hints.feature.
      queries: {
        retry: shouldRetryQuery,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
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

/**
 * A different signed-in actor or session starts a fresh cache: in-flight reads are cancelled and
 * every read goes, but the session read, which carries the key the next mirror is sealed under.
 */
export function resetUiQueries({
  queryClient,
  sessionQueryKey,
}: {
  queryClient: QueryClient;
  sessionQueryKey: readonly unknown[];
}): void {
  const sessionHash = hashKey(sessionQueryKey);
  const others = { predicate: (query: Query) => query.queryHash !== sessionHash };
  void queryClient.cancelQueries(others);
  queryClient.removeQueries(others);
  // Mutation answers go too: a minted token must not outlive the actor who minted it.
  queryClient.getMutationCache().clear();
}

function defaultMutationErrorReporter(error: unknown): void {
  showErrorToast({ error });
}
