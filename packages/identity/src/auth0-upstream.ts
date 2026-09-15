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
 * THE ONE TABLE. Three surfaces read the broker's strategy vocabulary — the
 * backfill's native derivation here, the connection bridge's branded buttons
 * (`platform/app/src/utils/auth0-bridge.ts`), and the linked-accounts
 * screen's row identity (`components/me/signInAccounts.ts`) — and they must
 * agree byte-for-byte for a brokered account to route to the same provider
 * everywhere. So the strategies live once, with each surface's asymmetry a
 * FLAG rather than an omission: `windowslive` is bridgeable (Auth0 routes
 * the connection) but never derivable, because better-auth keys a Microsoft
 * account by the per-tenant issuer in the token itself (see the
 * `account_issuer` migration) and no issuer stated ahead of a real sign-in
 * would be the one the callback asks for. Strategies absent from the table —
 * `auth0|` (the broker's own database: a password, not an upstream
 * identity), `samlp|`/`waad|` (enterprise connections, D09's per-tenant
 * wizard) — are deliberately unmapped everywhere.
 */

export interface Auth0SocialStrategy {
  /** The strategy segment of the broker's subject, pipe excluded. */
  strategy: string;
  /** better-auth's own provider id for the native identity. */
  nativeProviderId: string;
  /** Whether the backfill may state the native identifier ahead of a real
   *  sign-in — true exactly where the native issuer is knowable. */
  derivable: boolean;
}

export const AUTH0_SOCIAL_STRATEGIES: readonly Auth0SocialStrategy[] = [
  { strategy: "google-oauth2", nativeProviderId: "google", derivable: true },
  { strategy: "github", nativeProviderId: "github", derivable: true },
  { strategy: "windowslive", nativeProviderId: "microsoft", derivable: false },
];

/** The table row a subject's strategy names, or null — requiring a non-empty
 *  subject behind the pipe, because a bare strategy asserts nobody. */
export function auth0SocialStrategyOfSubject(
  subject: string,
): (Auth0SocialStrategy & { providerAccountId: string }) | null {
  for (const row of AUTH0_SOCIAL_STRATEGIES) {
    const prefix = `${row.strategy}|`;
    if (!subject.startsWith(prefix)) continue;
    const providerAccountId = subject.slice(prefix.length);
    if (providerAccountId.length === 0) return null;
    return { ...row, providerAccountId };
  }
  return null;
}

/** The native provider a strategy segment names, or null. For display
 *  surfaces that already split the subject themselves. */
export function nativeProviderIdOfAuth0Strategy(
  strategy: string,
): string | null {
  return (
    AUTH0_SOCIAL_STRATEGIES.find((row) => row.strategy === strategy)
      ?.nativeProviderId ?? null
  );
}

export interface Auth0UpstreamIdentity {
  /** better-auth's own provider id for the native provider. */
  providerId: string;
  /** The subject the upstream provider itself asserts — for Google the OIDC
   *  `sub`, for GitHub the numeric user id — which is exactly what the
   *  native callback arrives holding. */
  providerAccountId: string;
}

/**
 * The DERIVABLE upstream identity an Auth0 subject encodes, or null where it
 * encodes none we may state ahead of a sign-in. A null is an answer, not a
 * failure: most subjects are the broker's own database users, an enterprise
 * connection, or a Microsoft identity whose issuer only a token can name.
 */
export function upstreamOfAuth0Subject(
  subject: string,
): Auth0UpstreamIdentity | null {
  const row = auth0SocialStrategyOfSubject(subject);
  if (row === null || !row.derivable) return null;
  return {
    providerId: row.nativeProviderId,
    providerAccountId: row.providerAccountId,
  };
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
 *
 * D10 CONSTRAINT: a derived identifier may be what a person's working native
 * sign-in resolves through — the adapter answers the callback from it, so
 * better-auth never writes a native `Account` row of its own, and the
 * provider tokens each callback carries land on an `updateMany` that
 * matches no credential row (a deliberate no-op: nothing reads a social
 * provider's tokens after sign-in). The broker teardown must therefore
 * restate still-used derived identifiers as self-standing — a real native
 * row, which is also where tokens would start persisting — BEFORE deleting
 * broker rows, or the compensation detaches a sign-in that works today.
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
