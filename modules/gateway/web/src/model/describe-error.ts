/**
 * The whole explanation as one string for slots that can only take text. A
 * stand-in for the platform version, since some call sites cannot render JSX.
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
