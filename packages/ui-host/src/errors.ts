/**
 * What a browser feature does with a failure, in one place.
 */

import { explainAnyError } from "@langwatch/handled-error/presentation";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";

import type { UiFailureAction } from "./capabilities.ts";
import { currentUiFeedbackHost } from "./toaster.ts";

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
   * Headline for a failure the registry has no copy for. It names the action that failed
   * ("Couldn't create project") so an unrecognised error still says what the reader was doing —
   * a code the registry knows keeps its own, better title.
   */
  fallbackTitle?: string;
  /**
   * A sentence for a refusal the SCREEN can say more about than the registry. Ignored the
   * moment the error carries a code the application has copy for, so it can never talk over
   * registered copy.
   */
  description?: string;
  /** The single fix this failure offers, where there is one. */
  action?: UiFailureAction;
  /** Toast id, for deduping repeated failures of the same action. */
  id?: string;
};

/**
 * Reports a failure to the reader, correctly. This is the ONLY sanctioned way to report one
 * from a feature screen.
 */
export function showErrorToast({ error, ...options }: ShowErrorToastOptions): void {
  // A failure a global interceptor already answered — a licence limit that
  // opened the upgrade dialog, say — is reported. Toasting it again puts a
  // second, weaker account of the same refusal on top of the first.
  if (isHandledByGlobalHandler(error)) return;

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
 * The whole explanation as one string, for a slot that can only take text. Registry copy beats
 * the caller's fallback for the same reason it does on a toast: a code the registry knows
 * describes this exact failure, where the caller's headline only names the action.
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
 * As much of a react-hook-form as this helper touches. Structural and deliberately loose: the
 * forms that pass one in are typed by their own value shapes, and narrowing `setError` would
 * make every caller cast.
 */
type MinimalForm = {
  // oxlint-disable-next-line no-explicit-any
  setError: (name: any, error: { type: string; message: string }) => void;
};

/**
 * Places a server's field-level rejection on the fields it named. Answers `true` when it placed
 * something, which is the caller's signal NOT to also raise a toast — a refusal reported twice
 * reads as two failures.
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

/**
 * Failures a global interceptor already surfaced (modal or bespoke toast).
 * Lives in the host, not each feature, so one feature's mark is seen by
 * every other's `onError` — a per-package copy would double-report.
 */
const globallyHandled = new WeakSet<Error>();

/** Records that a global interceptor has already reported this failure. */
export function markHandledGlobally(error: Error): void {
  globallyHandled.add(error);
}

/**
 * Whether a global interceptor already reported this failure, which is a
 * component-level `onError`'s signal to stay quiet rather than duplicate it.
 */
export function isHandledByGlobalHandler(error: unknown): boolean {
  return error instanceof Error && globallyHandled.has(error);
}

/**
 * Whether a failure carries the transport's 404. Read structurally off the
 * serialised envelope rather than through the tRPC client class, so the host
 * stays clear of the transport its features are not allowed to name.
 */
export function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const data = (error as { data?: { httpStatus?: unknown } }).data;
  return data?.httpStatus === 404;
}
