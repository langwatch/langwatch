import type { Organization } from "@prisma/client";

export interface OAuthAccountLike {
  providerId: string;
  accountId: string;
}

/**
 * Auth0 via Azure exposes providerAccountId as "waad|connection-name|user-id".
 * Orgs set ssoProvider either to a provider name ("google") or to a providerAccountId
 * prefix ("waad|acme-connection") to pin SSO to a specific Auth0 connection.
 *
 * The prefix match requires a `|` delimiter to avoid accepting sibling
 * connections that merely share a prefix — e.g. an org pinned to
 * `waad|acme` must NOT accept an account with accountId
 * `waad|acme-prod|user-123`. Caught by CodeRabbit in PR review.
 */
export const isSsoProviderMatch = (
  org: Pick<Organization, "ssoProvider">,
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
 *
 * Rejects inputs with zero or multiple `@` characters — RFC 5321 allows
 * `@` inside quoted local-parts, but we don't support those in practice
 * and `extractEmailDomain("a@b@c.com")` returning `"b@c.com"` would be
 * a silent SSO routing bug. Caught by CodeRabbit in PR review.
 */
export const extractEmailDomain = (email: string | null | undefined): string | null => {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 0 || at === email.length - 1 || at !== email.lastIndexOf("@")) {
    return null;
  }
  return email.slice(at + 1).toLowerCase();
};
