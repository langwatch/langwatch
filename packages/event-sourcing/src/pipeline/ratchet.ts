/**
 * The type-string ratchet (ADR-105 decision 10).
 *
 * A pipeline's declared event and intent keys become the type strings
 * persisted on every stored event and outbox row of that shape, forever. A
 * Redux action name is ephemeral — rename the reducer key and nothing
 * downstream notices. A persisted type string is not: renaming or removing a
 * key here orphans every already-stored row carrying the old string, and
 * nothing has a case for it any more, so replay silently stops folding those
 * rows into state. Nothing at compile time catches this, because the
 * declaration with the new name is, on its own, perfectly well-typed.
 *
 * The ratchet is the check that catches it: a snapshot of the type strings a
 * declaration produced last time is compared against what it produces now,
 * and a string that disappears is reported. One implementation covers both
 * kinds — the snapshot is keyed by declaration name and compared the same
 * way whether the strings are a pipeline's events or a process manager's
 * intents. Only the diff between two snapshots lives here; reading the
 * committed snapshot file and deciding whether a violation should fail the
 * build is the application's job, so this stays a pure comparison that costs
 * nothing to test and carries no filesystem dependency.
 */

/** One declaration's persisted type strings, keyed by declaration name. */
export interface TypeStringSnapshot {
  readonly [declarationName: string]: readonly string[];
}

/** A declaration that lost one or more type strings between two snapshots. */
export interface RatchetViolation {
  readonly declaration: string;
  readonly missing: readonly string[];
}

/**
 * Compares a committed snapshot against what the declarations produce now.
 *
 * Additions are free — a new event or intent, or a whole new declaration,
 * changes nothing for stored rows and is never reported. Only disappearance is
 * a violation: a type string the snapshot remembers but `current` no longer
 * produces, whether because its declaration renamed the key or dropped the
 * declaration entirely. Every missing string is reported, and grouped by
 * declaration, so the violation names exactly which stored rows just lost
 * their route back into state.
 */
export function checkTypeStringRatchet(args: {
  snapshot: TypeStringSnapshot;
  current: TypeStringSnapshot;
}): readonly RatchetViolation[] {
  const violations: RatchetViolation[] = [];
  for (const declaration of Object.keys(args.snapshot).sort()) {
    const before = args.snapshot[declaration] ?? [];
    const after = new Set(args.current[declaration] ?? []);
    const missing = before.filter((type) => !after.has(type)).sort();
    if (missing.length > 0) violations.push({ declaration, missing });
  }
  return violations;
}

/**
 * Produces the snapshot to commit after a ratchet check passes.
 *
 * The result is the union of both inputs, sorted and deduped per declaration,
 * so committing it back is a no-op the next time nothing has changed and the
 * diff a real change produces is exactly the strings that were added — never a
 * reordering. That determinism is what keeps the committed file from churning
 * on every run regardless of whether the type strings actually moved.
 */
export function mergeSnapshot(args: {
  snapshot: TypeStringSnapshot;
  current: TypeStringSnapshot;
}): TypeStringSnapshot {
  const declarations = new Set([
    ...Object.keys(args.snapshot),
    ...Object.keys(args.current),
  ]);
  const merged: Record<string, readonly string[]> = {};
  for (const declaration of [...declarations].sort()) {
    const union = new Set([
      ...(args.snapshot[declaration] ?? []),
      ...(args.current[declaration] ?? []),
    ]);
    merged[declaration] = [...union].sort();
  }
  return merged;
}
