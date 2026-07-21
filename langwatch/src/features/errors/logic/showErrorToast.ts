import { toaster } from "~/components/ui/toaster";
import { isHandledByGlobalHandler } from "~/utils/trpcError";

import {
  explainHandledError,
  UNKNOWN_ERROR_PRESENTATION,
} from "./presentation";
import {
  readAuthoredMessage,
  readErrorTraceId,
  readHandledError,
} from "./readHandledError";

export interface ShowErrorToastOptions {
  /**
   * Headline for a failure we have no specific copy for.
   *
   * This is the option you almost always want. It names the action that
   * failed ("Couldn't create project") so an unrecognised or unhandled error
   * still says what the user was doing — but a code the registry knows keeps
   * its own, better title ("That name is taken"), because the specific fact
   * beats the generic one every time.
   */
  fallbackTitle?: string;
  /**
   * Hard override of the title, registry entry or not.
   *
   * Rare, and usually a smell: if the registry's copy is wrong for this code,
   * fix the registry rather than papering over it at one call site.
   */
  title?: string;
  /** Toast id, for deduping repeated failures of the same action. */
  id?: string;
}

/**
 * Shows any error to the user, correctly.
 *
 * This is the ONLY sanctioned way to toast an error. It exists because the
 * obvious thing — `toaster.create({ description: error.message })` — is wrong
 * in both directions: for a handled error the wire message is the code slug
 * (`validation_error`), and for an unhandled one the message can carry
 * internals. See `dev/docs/best_practices/error-handling.md`.
 *
 * Also absorbs the global-handler dedup check that ~137 call sites were
 * copy-pasting, so a license-limit error that already opened a modal doesn't
 * also toast.
 *
 * ```ts
 * onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't create project" }),
 * ```
 */
export function showErrorToast({
  error,
  ...options
}: ShowErrorToastOptions & { error: unknown }): void {
  // Already surfaced as a modal or a bespoke toast by the global interceptors
  // in `utils/api.tsx` — a second toast would be a duplicate report.
  if (isHandledByGlobalHandler(error)) return;

  const handled = readHandledError(error);
  const authored = readAuthoredMessage(error);
  const explanation = handled
    ? explainHandledError(handled)
    : authored
      ? { ...UNKNOWN_ERROR_PRESENTATION, description: authored }
      : UNKNOWN_ERROR_PRESENTATION;

  // A code the registry recognises has copy written for this exact failure, so
  // it wins over the caller's generic "couldn't do the thing". Everything else
  // — an unhandled error, or a code newer than this client — takes the
  // caller's headline, which at least names what the user was trying to do.
  const isRecognised = handled !== null && explanation.isRegistered;
  const title =
    options.title ??
    (isRecognised
      ? explanation.title
      : (options.fallbackTitle ?? explanation.title));

  toaster.create({
    ...(options.id ? { id: options.id } : {}),
    // The shared default is 5s, which is not long enough to read the copy,
    // decide, and click "Copy error ID" or "Read the docs". It stays
    // dismissable — `closable` is set below.
    duration: 12000,
    title,
    description: bodyCopy(explanation.description, handled?.tips),
    type: "error",
    meta: {
      closable: true,
      // Consumed by the Toaster's error rendering — the docs link and the
      // copyable error id, which is all a customer gets of the technical
      // detail (raw meta and the reason chain stay server-side).
      docsUrl: handled?.docsUrl,
      traceId: readErrorTraceId(error),
    },
  });
}

/**
 * Picks the body copy: the registry's description, or the first server tip.
 *
 * Never both. The two are competing authorings of the same remediation — the
 * registry entry for `query_timeout` says "Narrow the time range or add a
 * filter", and so does its first tip — so showing both makes the toast repeat
 * itself. The registry wins because it is written for this surface; tips are
 * written for agents driving the API/CLI/MCP, which have no registry to read
 * (ADR-045). They still earn their place when the code is one this client
 * doesn't recognise and has no copy for.
 */
function bodyCopy(
  description: string,
  tips: readonly string[] | undefined,
): string {
  return description || (tips?.[0] ?? "");
}
