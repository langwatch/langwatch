import type { IdentifierFact, IdentityHeads } from "./facts.ts";

/**
 * A proven address an invitation may be accepted through (D11,
 * specs/identity/resilient-invitations.feature).
 */
export interface MatchableEmail {
  identifierId: string;
  value: string;
  provider: IdentifierFact["provider"];
}

/** Every proven address, or the instruction to keep the legacy `User.email` (ADR-146). */
export type VerifiedEmailsResolution =
  | { kind: "resolved"; emails: MatchableEmail[] }
  | { kind: "keep_legacy" };

/** Gets every verified address the user has proven. Only PRIMARY and VERIFIED are eligible for
 * invite acceptance, sorted by identifier id for deterministic results.
 */
export function matchableEmailsOf({ heads }: { heads: IdentityHeads }): MatchableEmail[] {
  return Object.values(heads.identifiers)
    .filter(
      (identifier): identifier is IdentifierFact & { value: string } =>
        (identifier.state === "PRIMARY" || identifier.state === "VERIFIED") &&
        typeof identifier.value === "string",
    )
    .toSorted((a, b) => a.identifierId.localeCompare(b.identifierId))
    .map(({ identifierId, value, provider }) => ({
      identifierId,
      value,
      provider,
    }));
}
