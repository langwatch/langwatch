import { toaster } from "~/components/ui/toaster";
import { isHandledByGlobalHandler } from "~/utils/trpcError";

import {
  UNKNOWN_ERROR_PRESENTATION,
  explainHandledError,
} from "./presentation";
import { readErrorTraceId, readHandledError } from "./readHandledError";

export interface ShowErrorToastOptions {
  /**
   * Overrides the registry title. Use only where the surrounding context makes
   * a better headline than the generic one — "Couldn't save your changes"
   * beats "Check your input" on a settings form.
   *
   * Do NOT use it to paper over a missing registry entry; add the entry.
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
 * onError: (error) => showErrorToast(error, { title: "Couldn't create project" }),
 * ```
 */
export function showErrorToast(
  error: unknown,
  options: ShowErrorToastOptions = {},
): void {
  // Already surfaced as a modal or a bespoke toast by the global interceptors
  // in `utils/api.tsx` — a second toast would be a duplicate report.
  if (isHandledByGlobalHandler(error)) return;

  const handled = readHandledError(error);
  const explanation = handled
    ? explainHandledError(handled)
    : UNKNOWN_ERROR_PRESENTATION;

  toaster.create({
    ...(options.id ? { id: options.id } : {}),
    title: options.title ?? explanation.title,
    description: describeWithTips(explanation.description, handled?.tips),
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
 * Folds the first remediation tip into the description.
 *
 * Tips are authored for agents hitting the API/CLI, where a list renders fine.
 * A toast has room for one sentence, so it takes the most actionable one and
 * leaves the rest to the docs link — rather than either dropping the
 * remediation entirely or turning the toast into a wall of bullets.
 */
function describeWithTips(
  description: string,
  tips: readonly string[] | undefined,
): string {
  const firstTip = tips?.[0];
  if (!firstTip) return description;
  if (!description) return firstTip;
  return `${description} ${firstTip}`;
}
