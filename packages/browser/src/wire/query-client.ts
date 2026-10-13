/**
 * The browser's one `QueryClient`. Mutations auto-report through
 * `showErrorToast`; queries do not — a query failure already renders
 * inline, and auto-reporting a background refetch would double it.
 */

import { PERSISTED_QUERY_MAX_AGE } from "@langwatch/browser-host/cache-tiers";
import { showErrorToast } from "@langwatch/browser-host/errors";
import { isServerUnreachable, UI_API_HEALTH_PATH } from "@langwatch/browser-host/navigation";
import { queryRetryDelay, shouldRetryQuery } from "@langwatch/browser-host/query-retry";
import { isForbiddenAnswer } from "@langwatch/browser-host/session-version";
import { hashKey, MutationCache, QueryCache, QueryClient, type Query } from "@tanstack/react-query";

export type UiQueryClientOptions = {
  /**
   * Called once per failed mutation; defaults to `showErrorToast`. Queries
   * carry no equivalent hook — deliberate, see the file docblock.
   */
  onMutationError?: (error: unknown) => void;
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
  sessionQueryKey,
}: UiQueryClientOptions = {}): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      // A read is trusted for 5 minutes, then refetched when the tab is shown or reconnects; a read
      // hint refetches it sooner. "Focused" is the library's default: the tab is visible, whatever
      // the window focus. Query-sync owns the one pass on showing, so the library's is off. Every
      // read is mirrored, so each stays in memory as long as its mirror. ARCHITECTURE.md §10.2.
      queries: {
        retry: shouldRetryQuery,
        retryDelay: queryRetryDelay,
        staleTime: 5 * 60_000,
        gcTime: PERSISTED_QUERY_MAX_AGE,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        refetchIntervalInBackground: false,
      },
    },
    mutationCache: new MutationCache({ onError: onMutationError }),
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (isServerUnreachable(error)) return recover();
        if (!sessionQueryKey || !isForbiddenAnswer(error)) return;
        if (query.queryHash === hashKey(sessionQueryKey)) return;
        if (queryClient.isFetching({ queryKey: sessionQueryKey, exact: true }) > 0) return;
        void queryClient.refetchQueries({ queryKey: sessionQueryKey, exact: true });
      },
    }),
  });
  const recover = recoverWhenServerAnswers({ queryClient });
  return queryClient;
}

/** The first look for the API after a read could not reach it, and the slowest it eases to. */
const RECOVERY_FIRST_DELAY_MS = 2_000;
const RECOVERY_MAX_DELAY_MS = 15_000;

function isUnreachableFailure(query: Query): boolean {
  return query.state.status === "error" && isServerUnreachable(query.state.error);
}

/**
 * While a read's last failure is "nothing answered", polls the API's health route, easing off;
 * once it answers, the failed reads run again so each screen draws itself. The browser's
 * `online` event never fires when only the server was down. Spec: specs/ui/api-boot-wait.feature
 */
function recoverWhenServerAnswers({ queryClient }: { queryClient: QueryClient }): () => void {
  let polling = false;
  const poll = (delay: number): void => {
    setTimeout(() => {
      const failed = { predicate: isUnreachableFailure };
      if (queryClient.getQueryCache().findAll(failed).length === 0) {
        polling = false;
        return;
      }
      void healthAnswers().then((answered) => {
        if (!answered) return poll(Math.min(delay * 2, RECOVERY_MAX_DELAY_MS));
        polling = false;
        void queryClient.refetchQueries({ ...failed, type: "active" });
      });
    }, delay);
  };
  return () => {
    if (polling) return;
    polling = true;
    poll(RECOVERY_FIRST_DELAY_MS);
  };
}

async function healthAnswers(): Promise<boolean> {
  try {
    return (await fetch(UI_API_HEALTH_PATH, { cache: "no-store" })).ok;
  } catch {
    return false;
  }
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
