const SAFE_RETURN_TO_REGEX = /^\/(?!\/)[^\r\n]*$/;

/**
 * Returns a sanitized, internal path when the provided value is a safe
 * relative route. Paths must begin with a single slash and may not include
 * newline characters or double-slash prefixes that would allow scheme-relative
 * URLs.
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

  if (!SAFE_RETURN_TO_REGEX.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}
