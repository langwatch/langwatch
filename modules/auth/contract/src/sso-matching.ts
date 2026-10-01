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

/** The organization claiming a domain through the legacy `ssoDomain` column,
 *  with the provider it pins. */
export interface OrganizationSsoProviderLookup {
  findByDomain(args: {
    domain: string;
  }): Promise<{ id: string; name: string; ssoProvider: string | null } | null>;
}

/** Whether ANY of the accounts satisfies the provider the domain's organization
 *  pins: the one answer the sign-in hook that clears `pendingSsoSetup` and the
 *  status read that reports it share, so they never drift. */
export const matchesConfiguredSsoProvider = async (args: {
  organizations: OrganizationSsoProviderLookup;
  domain: string;
  accounts: readonly OAuthAccountLike[];
}): Promise<boolean> => (await configuredSsoProviderStatus(args)) === "matched";

/** Three answers, not two: `unconfigured` when no organization claims the
 *  domain or it pins no provider, so "nothing to satisfy" reads apart from
 *  "not yet satisfied". Looks the organization up once per call. */
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
  return accounts.some((account) => isSsoProviderMatch(org, account)) ? "matched" : "unmatched";
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
