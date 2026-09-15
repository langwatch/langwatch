/**
 * Exactly one credential per request; no precedence guessing. Each boundary
 * resolves its own kind's refusal, not a fall-through.
 */

/** One credential kind's claim on a request, named for refusals. */
export type CredentialClaim = { kind: string };

export type ClaimArbitration<T extends CredentialClaim> =
  /** Exactly one kind is in play: it decides the request. */
  | { outcome: "claimed"; claim: T }
  /** No kind is in play: the request is structurally unauthenticated. */
  | { outcome: "unclaimed" }
  /**
   * More than one kind is in play: refused as ambiguous. `kinds` names every
   * claimant so the refusal can tell the caller exactly what to drop.
   */
  | { outcome: "contested"; kinds: string[] };

/**
 * Arbitrate the claims gathered for one request. Absent entries (`null` /
 * `undefined`) are kinds that inspected the request and abstained.
 */
export function arbitrateClaims<T extends CredentialClaim>(
  claims: readonly (T | null | undefined)[],
): ClaimArbitration<T> {
  const present = claims.filter((claim): claim is T => claim != null);
  const first = present[0];
  if (!first) return { outcome: "unclaimed" };
  if (present.length > 1) {
    return { outcome: "contested", kinds: present.map((claim) => claim.kind) };
  }
  return { outcome: "claimed", claim: first };
}
