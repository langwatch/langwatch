import { isEntraIssuer } from "./sso-entra-issuer.ts";

/**
 * What an identity provider said about the address it asserted. "Said no" and
 * "said nothing" differ: Entra ID never sends `email_verified` (it may send
 * `xms_edov`) and SAML carries neither. Any explicit negative wins.
 */
export type AssertedEmailVerification = "verified" | "unverified" | "unasserted";

/** The boolean claims among these, as providers send them: a JSON boolean
 *  or its string. Anything else is no answer. */
function booleanClaimsIn(values: readonly unknown[]): boolean[] {
  return values.flatMap((value) => {
    if (value === true || value === "true") return [true];
    if (value === false || value === "false") return [false];
    return [];
  });
}

/** Reads `email_verified` from every claim source (the verified ID token and
 *  the userinfo response), plus `xms_edov` when the issuer is Entra ID. */
export function assertedEmailVerification({
  claimSources,
  issuer,
}: {
  claimSources: readonly Readonly<Record<string, unknown>>[];
  issuer: string | null | undefined;
}): AssertedEmailVerification {
  const entra = isEntraIssuer(issuer);
  const answers = claimSources.flatMap((claims) =>
    booleanClaimsIn(entra ? [claims.email_verified, claims.xms_edov] : [claims.email_verified]),
  );
  if (answers.includes(false)) return "unverified";
  if (answers.includes(true)) return "verified";
  return "unasserted";
}
