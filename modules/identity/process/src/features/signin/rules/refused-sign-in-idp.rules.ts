import type { SignInIdpKind, SsoConnectionType } from "@langwatch/identity-contract";

/** Issuer hosts and the provider kind they belong to; a suffix match, so subdomains count. */
const ISSUER_HOST_KINDS: readonly (readonly [suffix: string, kind: SignInIdpKind])[] = [
  ["okta.com", "okta"],
  ["oktapreview.com", "okta"],
  ["okta-emea.com", "okta"],
  ["microsoftonline.com", "entra"],
  ["sts.windows.net", "entra"],
  ["login.microsoft.com", "entra"],
  ["ciamlogin.com", "entra"],
  ["accounts.google.com", "google"],
  ["onelogin.com", "onelogin"],
  ["jumpcloud.com", "jumpcloud"],
  ["pingone.com", "ping"],
  ["pingone.eu", "ping"],
  ["pingone.asia", "ping"],
  ["pingidentity.com", "ping"],
  ["auth0.com", "auth0"],
];

/** Installation-wide providers whose own name says what kind of company sign-in they are. */
const PROVIDER_ID_KINDS: Readonly<Record<string, SignInIdpKind>> = {
  okta: "okta",
  "azure-ad": "entra",
  microsoft: "entra",
  google: "google",
  onelogin: "onelogin",
  auth0: "auth0",
  oidc: "oidc",
};

/** The kind an organization's connection speaks to: its issuer's host, else its protocol. */
export function classifyConnectionIdpKind({
  issuer,
  type,
}: {
  issuer: string | null;
  type: SsoConnectionType;
}): SignInIdpKind {
  return deriveIssuerKind(issuer) ?? type;
}

/** The kind an installation provider is, or undefined for one that is no company sign-in. */
export function classifyProviderIdpKind({
  providerId,
}: {
  providerId: string;
}): SignInIdpKind | undefined {
  return Object.hasOwn(PROVIDER_ID_KINDS, providerId) ? PROVIDER_ID_KINDS[providerId] : undefined;
}

function deriveIssuerKind(issuer: string | null): SignInIdpKind | undefined {
  if (!issuer) return undefined;
  let host: string;
  try {
    host = new URL(issuer).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  const match = ISSUER_HOST_KINDS.find(
    ([suffix]) => host === suffix || host.endsWith(`.${suffix}`),
  );
  return match?.[1];
}

/** The domain of an address, lower-cased; undefined when the text is no address. */
export function extractEmailDomain(email: string): string | undefined {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return undefined;
  return email
    .slice(at + 1)
    .trim()
    .toLowerCase();
}
