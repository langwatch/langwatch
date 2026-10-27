import type { IdentifierFact, IdentityHeads } from "./facts.ts";

/** Picks the user's primary email: PRIMARY if set, else the most recent VERIFIED. Answers the
 * legacy `User.email` column question; see ADR-101 §5 and D03.
 */
export function pickPrimaryEmail({ heads }: { heads: IdentityHeads }): string | null {
  const identifiers = Object.values(heads.identifiers).filter(
    (identifier): identifier is IdentifierFact & { value: string } =>
      identifier.provider === "email" && typeof identifier.value === "string",
  );
  const primary = identifiers.find((identifier) => identifier.state === "PRIMARY");
  if (primary) return primary.value;

  const verified = identifiers
    .filter((identifier) => identifier.state === "VERIFIED")
    .toSorted(
      (a, b) =>
        (b.verifiedAtMs ?? 0) - (a.verifiedAtMs ?? 0) ||
        a.identifierId.localeCompare(b.identifierId),
    );
  return verified[0]?.value ?? null;
}
