/** Seam that a composition can plug a registry into, so error copy isn't baked into the app. */

import type { AuthErrorExplanation } from "@langwatch/auth-contract";
import { explainHandledError } from "@langwatch/handled-error/presentation";

import { frontDoorErrorCopy } from "./front-door-error-copy.ts";
import type { AuthHandledError } from "./read-handled-error.ts";

/** Registry function that reads the whole error to fill in templated copy. */
export type ExplainErrorCode = (error: AuthHandledError) => AuthErrorExplanation | null;

/** The app-wide registry's copy for a code it lists (main's `presentation.ts`), else `null`. */
function sharedRegistryCopy(error: AuthHandledError): AuthErrorExplanation | null {
  const explained = explainHandledError({
    ...error,
    fault: error.httpStatus >= 500 ? "platform" : "customer",
    retryable: false,
    docsUrl: undefined,
    reasons: [],
  });
  if (!explained.isRegistered) return null;
  return explained.description
    ? { title: explained.title, description: explained.description }
    : { title: explained.title };
}

/**
 * The front door's own codes first, then the app-wide registry, until a composition installs
 * another. See `front-door-error-copy.ts` for why this package holds any copy at all.
 */
let installed: ExplainErrorCode = (error) => frontDoorErrorCopy(error) ?? sharedRegistryCopy(error);

/**
 * Hands the front door this composition's error copy. Called once, by the
 * feature that installs these screens. Returns the way to put the previous
 * explainer back, so a suite can install a stub without leaking into the next file.
 */
export function installAuthErrorExplainer(explain: ExplainErrorCode): () => void {
  const previous = installed;
  installed = explain;
  return () => {
    installed = previous;
  };
}

/** The registry's copy for a failure, or `null` when this composition lists none. */
export function explainErrorCode(error: AuthHandledError): AuthErrorExplanation | null {
  try {
    return installed(error);
  } catch {
    // A registry that throws is a bug in the composition, not a reason for a
    // sign-in screen to go blank.
    return null;
  }
}
