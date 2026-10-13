/** A redirect target longer than this is not a route on this site. */
const MAX_RETURN_TO_LENGTH = 2048;

/**
 * A sanitized internal path, or null. One slash, then neither a slash nor a backslash (browsers
 * read both `//host` and `/\host` as scheme-relative), no line break, tab or NUL. Applied before a
 * path is mailed, stored or followed, so a hand-crafted query gets a genuine one's answer.
 */
export function getSafeReturnToPath(returnTo?: string | string[] | null): string | null {
  const value = typeof returnTo === "string" ? returnTo : null;
  if (!value || value.length > MAX_RETURN_TO_LENGTH) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/[\r\n\t\0]/.test(value)) return null;
  return value;
}
