// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The vendor's own spelling for a stored provider identifier. The raw
 * identifier is never rendered: it is lowercase, sometimes internal, and
 * occasionally the protocol rather than a product. `null` is the honest answer
 * for one we cannot spell, because the right fallback differs per screen — a
 * chip wants "Directory", a migration button wants "your previous provider".
 */
const SPELLINGS: Record<string, string> = {
  auth0: "Auth0",
  okta: "Okta",
  onelogin: "OneLogin",
  azuread: "Microsoft Entra ID",
  entra: "Microsoft Entra ID",
  entraid: "Microsoft Entra ID",
  ping: "Ping Identity",
  pingfederate: "Ping Identity",
  jumpcloud: "JumpCloud",
  google: "Google Workspace",
  keycloak: "Keycloak",
};

/**
 * The vendor's spelling, or null when the identifier names nothing we know.
 * "scim" and "saml" are deliberately absent: they are protocols, not products.
 */
export function providerDisplayName(providerId: string | null | undefined): string | null {
  if (!providerId) return null;

  return SPELLINGS[providerId.trim().toLowerCase()] ?? null;
}
