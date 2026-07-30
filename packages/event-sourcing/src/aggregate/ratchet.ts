/**
 * The event-type-string ratchet (ADR-105 §3).
 *
 * An aggregate's event types are the map keys given to `defineAggregate`, and
 * those keys are also the `type` string persisted on every stored event of
 * that shape, forever. A Redux action name is ephemeral — rename the reducer
 * key and nothing downstream notices. An event type string is not: renaming or
 * removing a key here orphans every already-stored row carrying the old
 * string, and `apply` has no case for it any more, so replay silently stops
 * folding those rows into state. Nothing at compile time or at mount time
 * catches this, because the map with the new key is, on its own, perfectly
 * well-typed.
 *
 * The ratchet is the check that catches it: a snapshot of the type strings an
 * aggregate declared last time is compared against what it declares now, and
 * a string that disappears is reported. Only the diff between two snapshots
 * lives here; reading the committed snapshot file and deciding whether a
 * violation should fail the build is the application's job; this stays a pure
 * comparison so it costs nothing to test and carries no filesystem dependency.
 */

/** One aggregate's declared event type strings, keyed by aggregate name. */
export interface TypeStringSnapshot {
  readonly [aggregateName: string]: readonly string[];
}

/** An aggregate that lost one or more type strings between two snapshots. */
export interface RatchetViolation {
  readonly aggregate: string;
  readonly missing: readonly string[];
}

/**
 * Compares a committed snapshot against what the aggregates declare now.
 *
 * Additions are free — a new event type, or a whole new aggregate, changes
 * nothing for stored rows and is never reported. Only disappearance is a
 * violation: a type string the snapshot remembers but `current` no longer
 * declares, whether because its aggregate renamed the key or dropped the
 * aggregate entirely. Every missing string is reported, and grouped by
 * aggregate, so the violation names exactly which stored rows just lost their
 * route back into state.
 */
export function checkTypeStringRatchet(args: {
  snapshot: TypeStringSnapshot;
  current: TypeStringSnapshot;
}): readonly RatchetViolation[] {
  const violations: RatchetViolation[] = [];
  for (const aggregate of Object.keys(args.snapshot).sort()) {
    const before = args.snapshot[aggregate] ?? [];
    const after = new Set(args.current[aggregate] ?? []);
    const missing = before.filter((type) => !after.has(type)).sort();
    if (missing.length > 0) violations.push({ aggregate, missing });
  }
  return violations;
}

/**
 * Produces the snapshot to commit after a ratchet check passes.
 *
 * The result is the union of both inputs, sorted and deduped per aggregate, so
 * committing it back is a no-op the next time nothing has changed and the diff
 * a real change produces is exactly the strings that were added — never a
 * reordering. That determinism is what keeps the committed file from churning
 * on every run regardless of whether the type strings actually moved.
 */
export function mergeSnapshot(args: {
  snapshot: TypeStringSnapshot;
  current: TypeStringSnapshot;
}): TypeStringSnapshot {
  const aggregates = new Set([
    ...Object.keys(args.snapshot),
    ...Object.keys(args.current),
  ]);
  const merged: Record<string, readonly string[]> = {};
  for (const aggregate of [...aggregates].sort()) {
    const union = new Set([
      ...(args.snapshot[aggregate] ?? []),
      ...(args.current[aggregate] ?? []),
    ]);
    merged[aggregate] = [...union].sort();
  }
  return merged;
}
