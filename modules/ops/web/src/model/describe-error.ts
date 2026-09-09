/**
 * The whole explanation as one string, for slots that can only take text.
 *
 * A family-local stand-in for `platform/app/src/features/errors`'s
 * `describeError`, kept because a handful of call sites put a failure into a
 * `string` slot — a Deja View banner, a toast title assembled by a mutation
 * hook. Those slots cannot render a component, which is why the platform helper
 * exists at all.
 *
 * WHAT DOES NOT TRAVEL is the code-keyed presentation registry: the platform
 * version resolves the specific title and description for a named code, and
 * this one says what that registry itself says for a code it does not list —
 * the action that failed, then the generic line. The registry harvest is its
 * own slice, and this function is one of the places that gets better when it
 * lands. The gateway and governance families carry the same stand-in with the
 * same gap; they converge when the registry moves.
 */

/** The generic line, shared with the inline alert so the two never diverge. */
export const UNKNOWN_ERROR_DESCRIPTION = "Something went wrong on our side. Try again in a moment.";

export function describeError({
  error: _error,
  fallbackTitle,
}: {
  error: unknown;
  fallbackTitle?: string;
}): string {
  return `${fallbackTitle ?? "Something went wrong"}. ${UNKNOWN_ERROR_DESCRIPTION}`;
}
