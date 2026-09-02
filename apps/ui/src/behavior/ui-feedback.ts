/**
 * The feedback capability, over the Design System's toaster.
 *
 * A screen never composes the sentence a customer reads for a failure: it hands
 * over the raw error and names the action that failed, and the words are
 * resolved HERE from the error's `code`. That split is the whole point of
 * `UiFailureNotice` — since #5984 the wire message of a handled error is the
 * code slug, so a screen that toasted `error.message` would print
 * `validation_error` at the customer.
 *
 * DELIBERATELY MINIMAL. `platform/app/src/features/errors/logic/presentation.ts`
 * is the real registry: ~90 codes, each with a title, a description, tips and a
 * docs link, plus the tip-folding and global-handler dedup rules around it.
 * Harvesting it is its own slice. What lives here is the shape that slice will
 * fill: read the code off whichever envelope carried it, look it up, and fall
 * back to the action name plus the generic line when the code is unknown —
 * which is the same answer the full registry gives for an unregistered code.
 */

import { toaster } from "@langwatch/design-system/toaster";
import { UiFeedbackPort, type UiFailureNotice, type UiSuccessNotice } from "./ui-capabilities";

/** How long a failure stays up: long enough to read it and copy the error id. */
const FAILURE_DURATION_MS = 12_000;

/** The line a failure we cannot name gets, and the floor under every other one. */
export const UNKNOWN_UI_FAILURE_DESCRIPTION =
  "Something went wrong on our side. Try again in a moment.";

/** What a screen's `fallbackTitle` is replaced by when the code is known. */
type UiFailureCopy = { title: string; description: string };

/**
 * The codes this composition can already say something better about.
 *
 * Kept to the handful a moved screen actually raises. A code that is not here
 * is not a bug — it degrades to the action name and the generic line, which is
 * the honest answer rather than a guess.
 */
export const UI_FAILURE_COPY: Readonly<Record<string, UiFailureCopy>> = {
  insufficient_permissions: {
    title: "You do not have access to this",
    description: "Ask an organization admin to grant you the permission this page needs.",
  },
  validation_error: {
    title: "Check the details you entered",
    description:
      "Some of what was submitted is not valid. Correct the highlighted fields and try again.",
  },
  not_found: {
    title: "That is no longer here",
    description: "It was removed, or the address is wrong. Go back and open it from the list.",
  },
  rate_limited: {
    title: "Too many requests",
    description: "Wait a moment and try again.",
  },
};

/**
 * The code a failure carries, whichever boundary sent it.
 *
 * tRPC nests the handled payload under `data.error`; a REST route sends it flat
 * with the code in `error`. Anything else is an unhandled failure and has no
 * code to read, which is the `undefined` this returns.
 */
export function readUiFailureCode(error: unknown): string | undefined {
  const nested = (error as { data?: { error?: { code?: unknown } } } | null)?.data?.error?.code;
  if (typeof nested === "string") return nested;
  const flat = (error as { error?: unknown } | null)?.error;
  if (typeof flat === "string") return flat;
  return void 0;
}

/**
 * The words for one failure: the registry's when it has them, the caller's
 * otherwise, and the generic line when neither has anything.
 *
 * The registry still WINS over a caller's own description, which is the property
 * that keeps `description` from being a way to talk over registered copy. It
 * only fills the gap where there is no code to look up at all.
 */
export function resolveUiFailureCopy({
  error,
  fallbackTitle,
  description,
}: UiFailureNotice): UiFailureCopy {
  const code = readUiFailureCode(error);
  const registered = code === void 0 ? void 0 : UI_FAILURE_COPY[code];
  return (
    registered ?? {
      title: fallbackTitle,
      description: description ?? UNKNOWN_UI_FAILURE_DESCRIPTION,
    }
  );
}

/** The toaster this feedback is rendered on, so a test can record instead. */
export type UiToaster = {
  create: (toast: {
    id?: string;
    title: string;
    description?: string;
    type: string;
    duration?: number;
  }) => unknown;
};

export class BrowserUiFeedback extends UiFeedbackPort {
  static create(target: UiToaster = toaster): BrowserUiFeedback {
    return new BrowserUiFeedback(target);
  }

  private constructor(private readonly target: UiToaster) {
    super();
  }

  succeeded({ title, description, id }: UiSuccessNotice): void {
    this.target.create({
      ...(id ? { id } : {}),
      title,
      ...(description ? { description } : {}),
      type: "success",
    });
  }

  failed(failure: UiFailureNotice): void {
    const copy = resolveUiFailureCopy(failure);
    this.target.create({
      ...(failure.id ? { id: failure.id } : {}),
      title: copy.title,
      description: copy.description,
      type: "error",
      duration: FAILURE_DURATION_MS,
    });
  }
}
