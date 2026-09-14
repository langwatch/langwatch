/**
 * What an Auth0-brokered subject says about the identity BEHIND the broker
 * (D09). Auth0 encodes the upstream connection strategy as the first
 * pipe-delimited segment of `sub` — `google-oauth2|10769…` IS the statement
 * "this person's identity at Google is subject 10769…", with the broker's
 * own namespace wrapped around it. Unfolding that compound is adoption of a
 * fact the row already asserts, not invention of a new one, and it is what
 * lets a native provider's callback resolve a user who has only ever signed
 * in through the broker.
 *
 * Only strategies whose upstream subject survives the unfolding are listed.
 * `windowslive|` and `waad|` are deliberately absent: better-auth keys a
 * Microsoft account by the per-tenant issuer in the token itself (see the
 * `account_issuer` migration), so no issuer we could state ahead of a real
 * sign-in would be the one the callback asks for. `auth0|` is the broker's
 * own database — a password, not an upstream identity. `samlp|` is an
 * enterprise connection, which is D09's per-tenant wizard, never a bulk
 * derivation.
 */

const AUTH0_UPSTREAM_STRATEGIES = [
  { prefix: "google-oauth2|", providerId: "google" },
  { prefix: "github|", providerId: "github" },
] as const;

export interface Auth0UpstreamIdentity {
  /** better-auth's own provider id for the native provider. */
  providerId: string;
  /** The subject the upstream provider itself asserts — for Google the OIDC
   *  `sub`, for GitHub the numeric user id — which is exactly what the
   *  native callback arrives holding. */
  providerAccountId: string;
}

/**
 * The upstream identity an Auth0 subject encodes, or null where it encodes
 * none we can act on. A null is an answer, not a failure: most subjects are
 * the broker's own database users or an enterprise connection.
 */
export function upstreamOfAuth0Subject(
  subject: string,
): Auth0UpstreamIdentity | null {
  for (const strategy of AUTH0_UPSTREAM_STRATEGIES) {
    if (!subject.startsWith(strategy.prefix)) continue;
    const providerAccountId = subject.slice(strategy.prefix.length);
    if (providerAccountId.length === 0) return null;
    return { providerId: strategy.providerId, providerAccountId };
  }
  return null;
}

const DERIVED_ACCOUNT_ID_PREFIX = "drvacct:";

/**
 * The account id a DERIVED identifier carries — the row id better-auth sees
 * when the native callback is answered from it, before any native `Account`
 * row exists.
 *
 * Deterministic from the source row and the provider, so a restated backfill
 * pass states the same id, and parseable back to its source, so the orphan
 * compensation can follow the SOURCE row's liveness: delete the broker's
 * `Account` row and the derived identifier detaches with the adopted one
 * (`sourceOfDerivedAccountId`, read by `orphanedIdentifierRows`).
 */
export function derivedAccountId({
  sourceAccountId,
  providerId,
}: {
  sourceAccountId: string;
  providerId: string;
}): string {
  return `${DERIVED_ACCOUNT_ID_PREFIX}${providerId}:${sourceAccountId}`;
}

/** The source `Account` row id a derived account id names, or null for an
 *  ordinary account id. */
export function sourceOfDerivedAccountId(accountId: string): string | null {
  if (!accountId.startsWith(DERIVED_ACCOUNT_ID_PREFIX)) return null;
  const rest = accountId.slice(DERIVED_ACCOUNT_ID_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator <= 0 || separator === rest.length - 1) return null;
  return rest.slice(separator + 1);
}
