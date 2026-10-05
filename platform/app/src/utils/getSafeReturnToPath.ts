/**
 * A redirect target may be at most this long. Anything longer is not a route
 * on this site, whatever else it looks like.
 */
const MAX_RETURN_TO_LENGTH = 2048;

/**
 * Returns a sanitized, internal path when the provided value is a safe
 * relative route, and `null` otherwise.
 *
 * A safe route begins with a single forward slash and is followed by neither
 * a slash nor a backslash: browsers read `//host` as scheme-relative and
 * `/\host` as the same thing, so both would leave the site. It also carries
 * no line breaks, tabs or NUL bytes, which some agents strip before resolving
 * and which would otherwise smuggle a second slash past the check above.
 *
 * Used on the server before a path is mailed or stored, and on the client
 * before it is followed, so a hand-crafted query string gets the same answer
 * as a genuine one.
 *
 * @example
 * const safePath = getSafeReturnToPath(router.query.return_to as string);
 */
export function getSafeReturnToPath(
  returnTo?: string | string[] | null,
): string | null {
  const normalizedValue = typeof returnTo === "string" ? returnTo : null;

  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue.length > MAX_RETURN_TO_LENGTH) {
    return null;
  }

  if (!normalizedValue.startsWith("/")) {
    return null;
  }

  if (normalizedValue.startsWith("//") || normalizedValue.startsWith("/\\")) {
    return null;
  }

  if (/[\r\n\t\0]/.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}
