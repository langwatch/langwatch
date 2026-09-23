// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The sign-in provider under its supported name (#8143). `AUTH_PROVIDER` wins;
 * the NextAuth-era `NEXTAUTH_PROVIDER` still applies but is deprecated, so a
 * running install is never broken by the rename; neither set means email.
 */
export function configuredAuthProvider({
  authProvider,
  legacyProvider,
}: {
  authProvider: string | undefined;
  legacyProvider: string | undefined;
}): { provider: string; deprecatedNameUsed: boolean } {
  if (authProvider) return { provider: authProvider, deprecatedNameUsed: false };
  if (legacyProvider) return { provider: legacyProvider, deprecatedNameUsed: true };
  return { provider: "email", deprecatedNameUsed: false };
}
