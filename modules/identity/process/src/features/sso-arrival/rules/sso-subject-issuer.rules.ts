/** One issuer spelt with and without its trailing slash is still one issuer. */
const withoutTrailingSlash = (issuer: string): string =>
  issuer.endsWith("/") ? issuer.slice(0, -1) : issuer;

/**
 * The library finds a row by (connection, subject) alone, so a subject another issuer minted
 * would sign in as that row's person (ADR-189). Every connection row is stamped with its real
 * issuer, so a row with no issuer, or any `local:` namespace, names another one too.
 */
function isStoredUnderAnotherIssuer({
  storedIssuers,
  issuer: assertedIssuer,
}: {
  storedIssuers: readonly (string | null)[];
  issuer: string;
}): boolean {
  const asserted = withoutTrailingSlash(assertedIssuer);
  return storedIssuers.some(
    (issuer) => issuer === null || withoutTrailingSlash(issuer) !== asserted,
  );
}

/** Why a connection subject is refused for its issuer: one reason, or none (ADR-189). */
export function findSubjectIssuerRefusals({
  storedIssuers,
  issuer,
}: {
  storedIssuers: readonly (string | null)[];
  issuer: string | null | undefined;
}): string[] {
  if (!issuer) return ["Refused a single sign-on subject asserted under no issuer"];
  return isStoredUnderAnotherIssuer({ storedIssuers, issuer })
    ? ["Refused a single sign-on subject stored under another issuer"]
    : [];
}
