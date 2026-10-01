/**
 * The browser's one `QueryClient`. Mutations auto-report through
 * `showErrorToast`; queries do not — a query failure already renders
 * inline, and auto-reporting a background refetch would double it.
 */

import {
  applyCacheTiers,
  invalidateSessionTier,
  procedurePathOf,
  type UiCachePlan,
} from "@langwatch/browser-host/cache-tiers";
import { showErrorToast } from "@langwatch/browser-host/errors";
import { shouldRetryQuery } from "@langwatch/browser-host/query-retry";
import { isForbiddenAnswer } from "@langwatch/browser-host/session-version";
import {
  focusManager,
  MutationCache,
  type Query,
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
  /** The declared cache tiers (ADR-164); without one every read keeps the 30s default. */
  cachePlan?: UiCachePlan;
};

/**
 * Builds one `QueryClient`. Compose this rather than constructing
 * `new QueryClient()` by hand — the retry policy and the mutation reporter
 * are the browser's, not a call site's, to choose.
 */
export function createUiQueryClient({
  onMutationError = defaultMutationErrorReporter,
  cachePlan,
}: UiQueryClientOptions = {}): QueryClient {
  // A 403 means the session tier described a standing the server no longer grants. A
  // session read refused itself is not refetched again, or the refusal would loop.
  const onForbidden = ({
    error,
    query,
  }: {
    error: unknown;
    query?: Query<unknown, unknown, unknown>;
  }) => {
    if (!cachePlan || !isForbiddenAnswer(error)) return;
    if (query && cachePlan.tiers.get(procedurePathOf(query.queryKey) ?? "") === "session") return;
    void invalidateSessionTier({ queryClient, plan: cachePlan });
  };
  installFocusGate();
  const queryClient = new QueryClient({
    defaultOptions: {
      // Navigation and focus do not replay every mounted query; a screen
      // showing live state opts into focus refresh itself.
      queries: {
        retry: shouldRetryQuery,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        refetchIntervalInBackground: false,
      },
    },
    queryCache: new QueryCache({ onError: (error, query) => onForbidden({ error, query }) }),
    mutationCache: new MutationCache({
      onError: (error) => {
        onForbidden({ error });
        onMutationError(error);
      },
    }),
  });
  if (cachePlan) applyCacheTiers({ queryClient, plan: cachePlan });

  return queryClient;
}

function defaultMutationErrorReporter(error: unknown): void {
  showErrorToast({ error });
}
