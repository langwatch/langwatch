import type { IdentifierFact, IdentityHeads } from "./facts";

/**
 * Which of a user's identifiers answers "what is this person's email" —
 * the question the legacy `User.email` column used to answer on its own
 * (ADR-101 §5, the read fork D03 generalizes).
 *
 * The order is the lifecycle's own:
 *
 *   1. PRIMARY. It exists precisely to name the one identifier the user
 *      chose as theirs, so nothing else can outrank it.
 *   2. Otherwise the most recently VERIFIED one. A user who never marked a
 *      primary but proved a newer mailbox has told us something about which
 *      address is current; the older verified one is history.
 *   3. Otherwise nothing, and the caller keeps the legacy column. ATTACHED
 *      is deliberately not eligible: an unproven address must never become
 *      the address we mail, or attaching one would be a takeover.
 *
 * Ties break on identifier id so two pods answer identically — the ids are
 * derived from content, so this is stable across replay too.
 *
 * Erasure wipes `value`, so an erased identifier answers nothing here even
 * while its tombstone row stands.
 */
export function primaryEmailOf({
  heads,
}: {
  heads: IdentityHeads;
}): string | null {
  const identifiers = Object.values(heads.identifiers).filter(
    (identifier): identifier is IdentifierFact & { value: string } =>
      identifier.provider === "email" && typeof identifier.value === "string",
  );
  const primary = identifiers.find(
    (identifier) => identifier.state === "PRIMARY",
  );
  if (primary) return primary.value;

  const verified = identifiers
    .filter((identifier) => identifier.state === "VERIFIED")
    .sort(
      (a, b) =>
        (b.verifiedAtMs ?? 0) - (a.verifiedAtMs ?? 0) ||
        a.identifierId.localeCompare(b.identifierId),
    );
  return verified[0]?.value ?? null;
}
