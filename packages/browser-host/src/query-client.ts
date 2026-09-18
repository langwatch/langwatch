/**
 * The browser's one `QueryClient`. Mutations auto-report through
 * `showErrorToast`; queries do not — a query failure already renders
 * inline, and auto-reporting a background refetch would double it.
 */

import { MutationCache, QueryClient } from "@tanstack/react-query";

import { showErrorToast } from "./errors.ts";
import { shouldRetryQuery } from "./query-retry.ts";

export type UiQueryClientOptions = {
  /**
   * Called once per failed mutation; defaults to `showErrorToast`. Queries
   * carry no equivalent hook — deliberate, see the file docblock.
   */
  onMutationError?: (error: unknown) => void;
};

/**
 * Builds one `QueryClient`. Compose this rather than constructing
 * `new QueryClient()` by hand — the retry policy and the mutation reporter
 * are the browser's, not a call site's, to choose.
 */
export function createUiQueryClient({
  onMutationError = defaultMutationErrorReporter,
}: UiQueryClientOptions = {}): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: shouldRetryQuery } },
    mutationCache: new MutationCache({ onError: onMutationError }),
  });
}

function defaultMutationErrorReporter(error: unknown): void {
  showErrorToast({ error });
}
