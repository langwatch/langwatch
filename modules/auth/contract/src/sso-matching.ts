export interface OAuthAccountLike {
  providerId: string;
  accountId: string;
}

/**
 * Auth0 via Azure exposes providerAccountId as "waad|connection-name|user-id". Orgs set
 * ssoProvider either to a provider name ("google") or to a providerAccountId prefix
 * ("waad|acme-connection") to pin SSO to a specific Auth0 connection.
 */
export const isSsoProviderMatch = (
  org: { ssoProvider: string | null },
  account: OAuthAccountLike,
): boolean => {
  if (!org.ssoProvider) return false;
  return (
    account.accountId === org.ssoProvider ||
    account.accountId.startsWith(`${org.ssoProvider}|`) ||
    account.providerId === org.ssoProvider
  );
};

/**
 * Extract the lowercase domain from an email address.
 */
export const extractEmailDomain = (email: string | null | undefined): string | null => {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 0 || at === email.length - 1 || at !== email.lastIndexOf("@")) {
    return null;
  }
  return email.slice(at + 1).toLowerCase();
};
