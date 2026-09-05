/**
 * What the trace screens do with a failure.
 *
 * The report itself belongs to `@langwatch/ui-host/errors`: the failure travels
 * WHOLE to the application's feedback port, and the application resolves it
 * against the one code-keyed registry it owns. Nothing here reads a code, and
 * nothing here writes a sentence.
 *
 * WHAT THIS ADDS, and why it is still its own function: the global interceptors
 * in this family's tRPC client already surface some failures as a modal or a
 * bespoke toast, and reporting one of those again would show the reader the
 * same failure twice. That set is this package's, so the guard is too.
 */

import { showErrorToast as reportFailure } from "@langwatch/ui-host/errors";

import { isHandledByGlobalHandler } from "../../trpc-error";
import type { TraceFailureAction } from "../../trace-host";

export interface ShowErrorToastOptions {
  /**
   * Headline for a failure the registry has no copy for.
   *
   * It names the action that failed ("Couldn't create project") so an
   * unrecognised error still says what the user was doing — a code the registry
   * knows keeps its own, better title.
   */
  fallbackTitle?: string;
  /**
   * A sentence for a refusal the SCREEN can say more about than the registry.
   *
   * Ignored the moment the error carries a code the application has copy for,
   * so it can never talk over registered copy.
   */
  description?: string;
  /** The single fix this failure offers, where there is one. */
  action?: TraceFailureAction;
  /** Toast id, for deduping repeated failures of the same action. */
  id?: string;
}

/**
 * Reports any failure to the reader, correctly.
 *
 * This is the ONLY sanctioned way to report one from these screens. It exists
 * because the obvious thing — `toaster.create({ description: error.message })`
 * — is wrong in both directions: for a handled error the wire message is the
 * code slug (`validation_error`), and for an unhandled one the message can
 * carry internals. See `dev/docs/best_practices/error-handling.md`.
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
