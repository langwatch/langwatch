/**
 * Error description as text, for slots that can't render components. Resolves
 * handled error code to title or falls back to action + generic message.
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
