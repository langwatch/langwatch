/**
 * The words a customer reads for a platform error code, and the one seam that
 * supplies them.
 *
 * `platform/app/src/features/errors/logic/presentation.ts` is the registry:
 * ~90 codes, each with a title, a description, tips and a docs link. It is
 * 3,700 lines of the WHOLE PRODUCT'S error copy, it reaches `~/utils/docsUrl`,
 * and it has no package of its own yet — the manifests have carried "the full
 * presentation registry harvest is still owed" since the governance family.
 * Copying it into one feature package would put every other feature's copy
 * inside the front door and guarantee it drifts.
 *
 * So this module is the SEAM rather than the registry. A composition installs
 * whatever registry it has; a composition that installs none answers `null`,
 * and every reader falls through to the generic line plus a trace id — which
 * is exactly what the registry itself answers for a code it does not list
 * (ADR-045). The moment the harvest lands, the installer takes it and every
 * caller here starts reading real copy without changing a line.
 *
 * Module-level rather than a host-port method on purpose: `authFailureMessage`
 * is a pure function called from four screens and two model modules, none of
 * which hold a React context, and threading an explainer through all six would
 * have been a redesign of the failure-copy path rather than a move of it.
 */

import type { AuthErrorExplanation } from "./auth-host";
import { frontDoorErrorCopy } from "./front-door-error-copy";
import type { AuthHandledError } from "./read-handled-error";

export type { AuthErrorExplanation } from "./auth-host";

/**
 * What a registry answers: the copy for a failure, or nothing for one it lists
 * no copy for.
 *
 * It takes the WHOLE handled error rather than the code, because the registry's
 * own entries do: "try again in three minutes" reads `meta.retryAfterSeconds`,
 * and "this invitation was sent to a•••@example.com" reads `meta.invitedHint`.
 * A code-only seam would have silently dropped every sentence that names
 * something.
 */
export type ExplainErrorCode = (error: AuthHandledError) => AuthErrorExplanation | null;

/**
 * The front door's own codes, until a composition installs a fuller registry.
 * See `front-door-error-copy.ts` for why this package holds any copy at all.
 */
let installed: ExplainErrorCode = frontDoorErrorCopy;

/**
 * Hands the front door this composition's error copy.
 *
 * Called once, by the frontend feature that installs these screens. Returns
 * the way to put the previous explainer back, which is what lets a suite
 * install a stub without leaking it into the next file.
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
