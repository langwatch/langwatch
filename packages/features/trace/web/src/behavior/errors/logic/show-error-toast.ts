/**
 * What the trace screens do with a failure.
 *
 * It used to resolve the words here — `resolveErrorCopy` over a registry copied
 * into this package — and raise the toast on a toaster this package also
 * carried. That is a second authoring surface for customer copy and a second
 * toast renderer, which is the shape the code-keyed registry exists to prevent:
 * two places writing the words for `rate_limited` will eventually write two
 * different sentences, and only one of them gets kept up to date.
 *
 * So the failure travels WHOLE to `TraceHostPort.failed`, and the application
 * resolves it against the one registry it owns. Nothing here reads a code, and
 * nothing here writes a sentence.
 *
 * A SINGLETON, for the reason the toaster was one: most of these fire from a
 * mutation's `onError` or a promise rejection, where no hook can run. A failure
 * raised with no host mounted is warned about and dropped rather than thrown —
 * a failed report must never be the thing that takes the page down.
 */

import { isHandledByGlobalHandler } from "../../trpc-error";
import type { TraceFailureAction, TraceHostPort } from "../../trace-host";

export interface ShowErrorToastOptions {
  /**
   * Headline for a failure the registry has no copy for.
   *
   * This is the option you almost always want. It names the action that failed
   * ("Couldn't create project") so an unrecognised or unhandled error still
   * says what the user was doing — but a code the registry knows keeps its own,
   * better title ("That name is taken"), because the specific fact beats the
   * generic one every time.
   */
  fallbackTitle?: string;
  /**
   * A sentence for a refusal the SCREEN can say more about than the registry.
   *
   * Ignored the moment the error carries a code the application has copy for,
   * so it can never talk over registered copy. It is the channel for the
   * failures that have no code at all — a guard decided in the browser, a
   * clipboard the document was not allowed to write to.
   */
  description?: string;
  /** The single fix this failure offers, where there is one. */
  action?: TraceFailureAction;
  /** Toast id, for deduping repeated failures of the same action. */
  id?: string;
}

/** The generic headline, for a caller that names no action of its own. */
const UNNAMED_FAILURE_TITLE = "Something went wrong";

let mounted: TraceHostPort | undefined;

/** Called by the application's trace host provider on mount, cleared on unmount. */
export function setTraceErrorHost(host: TraceHostPort | undefined): void {
  mounted = host;
}

/**
 * Reports any failure to the reader, correctly.
 *
 * This is the ONLY sanctioned way to report one from these screens. It exists
 * because the obvious thing — `toaster.create({ description: error.message })`
 * — is wrong in both directions: for a handled error the wire message is the
 * code slug (`validation_error`), and for an unhandled one the message can
 * carry internals. See `dev/docs/best_practices/error-handling.md`.
 *
 * ```ts
 * onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't save" }),
 * ```
 */
export function showErrorToast({
  error,
  ...options
}: ShowErrorToastOptions & { error?: unknown }): void {
  // Already surfaced as a modal or a bespoke toast by the global interceptors
  // — a second report would be a duplicate.
  if (isHandledByGlobalHandler(error)) return;

  if (!mounted) {
    // oxlint-disable-next-line no-console
    console.warn("A trace failure was reported with no host mounted:", options.fallbackTitle);
    return;
  }

  mounted.failed({
    error,
    fallbackTitle: options.fallbackTitle ?? UNNAMED_FAILURE_TITLE,
    description: options.description,
    action: options.action,
    id: options.id,
  });
}
