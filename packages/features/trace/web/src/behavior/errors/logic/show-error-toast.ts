/**
 * What the trace screens do with a failure.
 */

import { showErrorToast as reportFailure } from "@langwatch/ui-host/errors";

import { isHandledByGlobalHandler } from "../../trpc-error";
import type { TraceFailureAction } from "../../trace-host";

export interface ShowErrorToastOptions {
  /**
   * Headline for a failure the registry has no copy for.
   */
  fallbackTitle?: string;
  /**
   * A sentence for a refusal the SCREEN can say more about than the registry.
   */
  description?: string;
  /** The single fix this failure offers, where there is one. */
  action?: TraceFailureAction;
  /** Toast id, for deduping repeated failures of the same action. */
  id?: string;
}

/**
 * Reports any failure to the reader, correctly.
 */
export function showErrorToast({
  error,
  ...options
}: ShowErrorToastOptions & { error?: unknown }): void {
  // Already surfaced as a modal or a bespoke toast by the global interceptors
  // — a second report would be a duplicate.
  if (isHandledByGlobalHandler(error)) return;

  reportFailure({ error, ...options });
}
