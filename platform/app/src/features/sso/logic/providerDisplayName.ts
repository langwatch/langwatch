/**
 * The vendor's own spelling for a stored provider identifier.
 *
 * TWO SCREENS HAD TWO STANDARDS FOR THE SAME PROBLEM. The migration screens
 * hardcoded one vendor's name in eight places, so an organization leaving
 * Google was told it was leaving Auth0. The directory group chip did the
 * opposite and rendered the stored identifier uppercased, which put the
 * literal word "SCIM" on a customer's screen whenever the source was the
 * protocol rather than a vendor. Both are the same question: what do we call
 * this thing to somebody who does not read our database?
 *
 * The raw identifier is never rendered. It is lowercase, sometimes internal,
 * and occasionally the protocol rather than a product. `null` is the honest
 * answer for one we cannot spell, and it is returned rather than a fallback
 * string because the right fallback differs per screen: a chip wants
 * "Directory", a migration button wants "your previous provider", and a
 * single module cannot know which.
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
 *
 * "scim" and "saml" are deliberately absent: they are protocols, not
 * products, so they resolve to null and each caller says what it means
 * instead of naming a vendor that does not exist.
 */
export function providerDisplayName(
  providerId: string | null | undefined,
): string | null {
  if (!providerId) return null;
  return SPELLINGS[providerId.trim().toLowerCase()] ?? null;
}
