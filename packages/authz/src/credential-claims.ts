/**
 * Credential arbitration: exactly one credential decides a request.
 *
 * The shape follows mojo's authenforce model. Every credential kind that is
 * in play on a request CLAIMS it; the runner requires exactly one claim.
 * Zero claims is structurally unauthenticated. Two or more is contested and
 * refused — arbitration never ranks credentials, because a precedence rule
 * is a guess about which identity the caller meant, and the guess is
 * invisible to them until it is wrong.
 *
 * The runner arbitrates; it does not resolve. Gathering each kind's claim —
 * "are these headers extractable API-key material", "does this cookie jar
 * resolve to a live session" — stays with the boundary that owns the
 * credential, which is also where a claimed-but-invalid credential turns
 * into that kind's own refusal rather than a fall-through to the next kind.
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
  claims: ReadonlyArray<T | null | undefined>,
): ClaimArbitration<T> {
  const present = claims.filter((claim): claim is T => claim != null);
  const first = present[0];
  if (!first) return { outcome: "unclaimed" };
  if (present.length > 1) {
    return { outcome: "contested", kinds: present.map((claim) => claim.kind) };
  }
  return { outcome: "claimed", claim: first };
}
