import type { IdentifierFact, IdentityHeads } from "./facts";

/**
 * A proven address an invitation may be accepted through (D11,
 * specs/identity/resilient-invitations.feature).
 */
export interface MatchableEmail {
  identifierId: string;
  value: string;
  provider: IdentifierFact["provider"];
}

/**
 * Every address a user has PROVEN, whatever method proved it — the email
 * ceremony, Google, or an SSO connection all carry the address as the
 * identifier's value. This is invite acceptance's question, which is wider
 * than `primaryEmailOf`'s: an invitation targets an address, and any
 * verified method holding that address vouches for it.
 *
 * ATTACHED is deliberately not eligible, exactly as in `primaryEmailOf`:
 * an unproven address must never open someone else's invitation. Erasure
 * wipes `value`, so an erased identifier can match nothing here.
 *
 * Sorted by identifier id so every pod answers identically.
 */
export function matchableEmailsOf({ heads }: { heads: IdentityHeads }): MatchableEmail[] {
  return Object.values(heads.identifiers)
    .filter(
      (identifier): identifier is IdentifierFact & { value: string } =>
        (identifier.state === "PRIMARY" || identifier.state === "VERIFIED") &&
        typeof identifier.value === "string",
    )
    .sort((a, b) => a.identifierId.localeCompare(b.identifierId))
    .map(({ identifierId, value, provider }) => ({
      identifierId,
      value,
      provider,
    }));
}
