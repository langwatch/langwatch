/** A redirect target longer than this is not a route on this site. */
const MAX_RETURN_TO_LENGTH = 2048;

/**
 * Whether a redirect target is a path on THIS site: one slash, then neither a slash nor a
 * backslash (browsers read `//host` and `/\host` as scheme-relative), no line break, tab or NUL.
 * Asked before a path is mailed, stored or followed, so a crafted query gets the same answer.
 */
export function isSafeReturnToPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.length > MAX_RETURN_TO_LENGTH || !value.startsWith("/")) return false;
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  return !/[\r\n\t\0]/.test(value);
}
