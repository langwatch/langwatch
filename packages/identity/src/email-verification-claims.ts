import { isEntraIssuer } from "./entra-issuer";

/**
 * What an identity provider said about whether it verified the address it
 * asserted, read from its own claims.
 *
 * Three answers, because "said no" and "said nothing" are different facts.
 * Keycloak, Okta, Auth0 and Google send `email_verified`. Microsoft Entra ID
 * never does; it can send `xms_edov` ("email domain owner verified"), an
 * optional claim the app registration has to request. SAML carries neither.
 *
 * - `verified`: the provider asserted the address is verified.
 * - `unverified`: the provider asserted it is NOT verified. Any explicit
 *   negative wins over a positive from another claim source.
 * - `unasserted`: the provider said nothing either way.
 */
export type AssertedEmailVerification = "verified" | "unverified" | "unasserted";

/** A boolean claim as providers send it: a JSON boolean or its string. */
function booleanClaim(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

/**
 * Reads `email_verified` from every claim source given (the verified ID
 * token, and the userinfo response when the provider has one), plus
 * `xms_edov` when the token's issuer is Microsoft Entra ID.
 */
export function assertedEmailVerification({
  claimSources,
  issuer,
}: {
  claimSources: readonly Readonly<Record<string, unknown>>[];
  issuer: string | null | undefined;
}): AssertedEmailVerification {
  const entra = isEntraIssuer(issuer);
  const answers: boolean[] = [];
  for (const claims of claimSources) {
    const emailVerified = booleanClaim(claims.email_verified);
    if (emailVerified !== undefined) answers.push(emailVerified);
    if (entra) {
      const domainOwnerVerified = booleanClaim(claims.xms_edov);
      if (domainOwnerVerified !== undefined) answers.push(domainOwnerVerified);
    }
  }
  if (answers.includes(false)) return "unverified";
  if (answers.includes(true)) return "verified";
  return "unasserted";
}
