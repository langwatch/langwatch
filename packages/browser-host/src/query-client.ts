/**
 * The browser's one `QueryClient`. Mutations auto-report through
 * `showErrorToast`; queries do not — a query failure already renders
 * inline, and auto-reporting a background refetch would double it.
 */

import { MutationCache, type Query, QueryCache, QueryClient } from "@tanstack/react-query";

import {
  applyCacheTiers,
  invalidateSessionTier,
  procedurePathOf,
  type UiCachePlan,
} from "./cache-tiers.ts";
import { showErrorToast } from "./errors.ts";
import { shouldRetryQuery } from "./query-retry.ts";
import { isForbiddenAnswer } from "./session-version.ts";

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
  const queryClient = new QueryClient({
    defaultOptions: {
      // Navigation and focus do not replay every mounted query; a screen
      // showing live state opts into focus refresh itself.
      queries: { retry: shouldRetryQuery, staleTime: 30_000, refetchOnWindowFocus: false },
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
