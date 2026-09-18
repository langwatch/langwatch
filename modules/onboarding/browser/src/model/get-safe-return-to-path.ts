const SAFE_RETURN_TO_REGEX = /^\/(?!\/)[^\r\n]*$/;

/**
 * Validates return URL path to prevent open redirects; must be a relative path
 * without scheme-relative prefixes or newlines.
 */
export function getSafeReturnToPath(returnTo?: string | string[] | null): string | null {
  const normalizedValue = typeof returnTo === "string" ? returnTo : null;

  if (!normalizedValue) {
    return null;
  }

  if (!SAFE_RETURN_TO_REGEX.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}
