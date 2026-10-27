import { issuerForProviderId } from "../../../rules/better-auth-account-queries.rules.ts";

/** One issuer spelt with and without its trailing slash is still one issuer. */
const withoutTrailingSlash = (issuer: string): string =>
  issuer.endsWith("/") ? issuer.slice(0, -1) : issuer;

/**
 * The library finds a row by (connection, subject) alone, so a subject another issuer minted
 * would sign in as that row's person (ADR-189). A row with no issuer, or this connection's
 * own synthetic namespace, predates the real issuer and names no other one.
 */
export function isStoredUnderAnotherIssuer({
  storedIssuers,
  providerId,
  issuer: assertedIssuer,
}: {
  storedIssuers: readonly (string | null)[];
  providerId: string;
  issuer: string;
}): boolean {
  const ownNamespace = issuerForProviderId(providerId);
  const asserted = withoutTrailingSlash(assertedIssuer);
  return storedIssuers.some(
    (issuer) =>
      issuer !== null && issuer !== ownNamespace && withoutTrailingSlash(issuer) !== asserted,
  );
}
