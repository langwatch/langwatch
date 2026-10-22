/**
 * The provider tokens an OAuth or OIDC callback hands Better Auth, none of which LangWatch keeps.
 * Sign-in asks providers for profile and email only, never calls them back on the person's behalf
 * and never signs out at the provider (`disableProviderLogout`), so every token is spent once the
 * callback is verified. A stored token is only something to leak.
 */
export const DISCARDED_PROVIDER_TOKENS = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
} as const;

/**
 * An account write with its provider tokens replaced by nulls, for a database hook to return as the
 * row Better Auth writes. The hook reads the ID token's claims before it calls this; the nulls also
 * clear tokens a row written before this rule still holds.
 */
export function withoutProviderTokens<T extends Record<string, unknown>>(
  data: T,
): T & typeof DISCARDED_PROVIDER_TOKENS {
  return { ...data, ...DISCARDED_PROVIDER_TOKENS };
}
