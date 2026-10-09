// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { Organization } from "~/generated/prisma/client";

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

/** The organization that claims a domain through the legacy `ssoDomain`
 *  column, with the provider it names — the shape both
 *  {@link matchesConfiguredSsoProvider} callers already look this up as. */
export interface OrganizationSsoProviderLookup {
  findByDomain(args: {
    domain: string;
  }): Promise<{ id: string; name: string; ssoProvider: string | null } | null>;
}

/**
 * Whether ANY of the given accounts already satisfies the SSO provider an
 * organization pins, for the given email domain, through the legacy
 * `ssoDomain` / `ssoProvider` columns.
 *
 * The one decision behind "this sign-in clears `pendingSsoSetup`" and "this
 * user no longer needs to be told to link SSO" — extracted so the sign-in
 * hook that clears the flag and the status read that reports it never drift
 * on what "already signed in with the right provider" means. Looks the
 * organization up itself, and only ONCE per call, so both callers ask the
 * same question the same way: the hook passes the single account it just saw
 * (`[account]`), the status read passes every account the user holds.
 */
export const matchesConfiguredSsoProvider = async (args: {
  organizations: OrganizationSsoProviderLookup;
  domain: string;
  accounts: readonly OAuthAccountLike[];
}): Promise<boolean> => (await configuredSsoProviderStatus(args)) === "matched";

/**
 * How the given accounts stand against the provider an organization pins for
 * the domain, in three answers rather than two: `unconfigured` when no
 * organization claims the domain or the one that does pins no provider, so a
 * reader can tell "nothing to satisfy" apart from "not yet satisfied". A
 * member is only ever asked to link the provider their organization names,
 * and an organization that has since dropped that pin names nothing.
 */
export const configuredSsoProviderStatus = async ({
  organizations,
  domain,
  accounts,
}: {
  organizations: OrganizationSsoProviderLookup;
  domain: string;
  accounts: readonly OAuthAccountLike[];
}): Promise<"matched" | "unmatched" | "unconfigured"> => {
  const org = await organizations.findByDomain({ domain });
  if (!org?.ssoProvider) return "unconfigured";
  return accounts.some((account) => isSsoProviderMatch(org, account))
    ? "matched"
    : "unmatched";
};

/**
 * Extract the lowercase domain from an email address.
 *
 * Rejects inputs with zero or multiple `@` characters — RFC 5321 allows
 * `@` inside quoted local-parts, but we don't support those in practice
 * and `extractEmailDomain("a@b@c.com")` returning `"b@c.com"` would be
 * a silent SSO routing bug. Caught by CodeRabbit in PR review.
 */
export const extractEmailDomain = (
  email: string | null | undefined,
): string | null => {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 0 || at === email.length - 1 || at !== email.lastIndexOf("@")) {
    return null;
  }
  return email.slice(at + 1).toLowerCase();
};
