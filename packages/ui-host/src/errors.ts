/**
 * What a browser feature does with a failure, in one place.
 *
 * Four packages carried their own copy of this over their own feature host
 * port, and each copy said the same thing in its own comment: the words a
 * customer reads belong to the code-keyed registry, so the failure must travel
 * WHOLE rather than as a sentence a screen composed. That is now true here,
 * once, and the registry is reachable — `@langwatch/handled-error/presentation`
 * is a contract package, so this module resolves the real copy instead of the
 * generic line every per-feature copy had to settle for.
 *
 * Nothing renders here: a report leaves through `UiFeedbackPort`, and the
 * application's toaster draws it. Explaining a failure for a surface that
 * renders it INTO the page (an alert, a dead-end state) is
 * `explainAnyError` from the presentation registry, imported directly.
 *
 * A SINGLETON, because most of these fire from a mutation's `onError` or a
 * promise rejection, where no hook can run. A failure reported with no host
 * mounted is warned about and dropped, never thrown.
 */

import { explainAnyError } from "@langwatch/handled-error/presentation";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";

import type { UiFailureAction } from "./capabilities";
import { currentUiFeedbackHost } from "./toaster";

/** The generic line, for a failure the registry has nothing specific to say about. */
export const UNKNOWN_ERROR_DESCRIPTION = "We've been notified. Try again in a moment.";

/** The headline for a caller that names no action of its own. */
const UNNAMED_FAILURE_TITLE = "Something went wrong";

/** An unknown thrown value, as an `Error`. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

export type ShowErrorToastOptions = {
  error?: unknown;
  /**
   * Headline for a failure the registry has no copy for.
   *
   * It names the action that failed ("Couldn't create project") so an
   * unrecognised error still says what the reader was doing — a code the
   * registry knows keeps its own, better title.
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
  action?: UiFailureAction;
  /** Toast id, for deduping repeated failures of the same action. */
  id?: string;
};

/**
 * Reports a failure to the reader, correctly.
 *
 * This is the ONLY sanctioned way to report one from a feature screen. The
 * obvious thing — `toaster.create({ description: error.message })` — is wrong
 * in both directions: for a handled error the wire message is the code slug,
 * and for an unhandled one the message can carry internals. See
 * `dev/docs/best_practices/error-handling.md`.
 */
export function showErrorToast({ error, ...options }: ShowErrorToastOptions): void {
  const host = currentUiFeedbackHost();
  if (!host) {
    // oxlint-disable-next-line no-console
    console.warn("A failure was reported with no feedback host mounted:", options.fallbackTitle);
    return;
  }
  host.failed({
    error,
    fallbackTitle: options.fallbackTitle ?? UNNAMED_FAILURE_TITLE,
    description: options.description,
    action: options.action,
    id: options.id,
  });
}

/**
 * The whole explanation as one string, for a slot that can only take text.
 *
 * Registry copy beats the caller's fallback for the same reason it does on a
 * toast: a code the registry knows describes this exact failure, where the
 * caller's headline only names the action.
 */
export function describeError({
  error,
  fallbackTitle,
}: {
  error: unknown;
  fallbackTitle?: string;
}): string {
  const explanation = explainAnyError(error);
  const headline = explanation.isRegistered
    ? explanation.title
    : (fallbackTitle ?? explanation.title);
  const description = explanation.description || UNKNOWN_ERROR_DESCRIPTION;
  return `${headline}. ${description}`;
}

/** The key `applyHandledErrorToForm` writes a whole-form refusal under. */
export const FORM_SERVER_ERROR = "root.serverError";

/**
 * As much of a react-hook-form as this helper touches.
 *
 * Structural and deliberately loose: the forms that pass one in are typed by
 * their own value shapes, and narrowing `setError` would make every caller cast.
 */
type MinimalForm = {
  // oxlint-disable-next-line no-explicit-any
  setError: (name: any, error: { type: string; message: string }) => void;
};

/**
 * Places a server's field-level rejection on the fields it named.
 *
 * Answers `true` when it placed something, which is the caller's signal NOT to
 * also raise a toast — a refusal reported twice reads as two failures.
 */
export function applyHandledErrorToForm({
  error,
  form,
  hasFormErrorSlot,
}: {
  error: unknown;
  form: MinimalForm;
  hasFormErrorSlot?: boolean;
}): boolean {
  const handled = readHandledError(error);
  if (!handled) return false;

  const fieldErrors = handled.meta.fieldErrors;
  let placed = false;
  if (typeof fieldErrors === "object" && fieldErrors !== null && !Array.isArray(fieldErrors)) {
    for (const [field, message] of Object.entries(fieldErrors)) {
      const text = Array.isArray(message) ? String(message[0] ?? "") : String(message ?? "");
      if (!text) continue;
      form.setError(field, { type: "server", message: text });
      placed = true;
    }
  }
  if (placed) return true;
  if (!hasFormErrorSlot) return false;

  const explanation = explainAnyError(error);
  form.setError(FORM_SERVER_ERROR, {
    type: "server",
    message: explanation.description || UNKNOWN_ERROR_DESCRIPTION,
  });
  return true;
}
