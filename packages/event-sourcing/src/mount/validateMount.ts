import type { Mount, MountShape, MountViolation } from "./mount.types";

/**
 * Checks a mount against ADR-106 decision 2's table, at composition time.
 *
 * Three rules had accumulated across ADR-098/099/100 — a fold's lane must be
 * scoped to one aggregate, a `map` writing to a `merge` store must declare its
 * idempotency story, a fold may not collapse its lane to the latest event —
 * and each was being enforced in a different place. This is the one place
 * left: a single function, called wherever a pipeline is assembled, that
 * knows every rule.
 *
 * It returns every violation rather than throwing on the first, so a mount
 * that is wrong in three ways is reported as wrong in three ways in one pass
 * — a caller fixing one and redeploying to discover the next is the failure
 * mode this function exists to avoid. The caller decides what "refused" means
 * (typically: throw `ConfigurationError` with the full list as `context`).
 */
export function validateMount(mount: Mount): MountViolation[] {
  const violations: MountViolation[] = [];

  if (mount.projection === "fold" && mount.scope !== "aggregate") {
    violations.push({
      rule: "fold-scope-must-be-aggregate",
      message:
        `a "fold" reads its prior state and writes it back, so mounting it on ` +
        `a "${mount.scope}" lane — wider than one aggregate — lets two ` +
        `concurrent applies to the same aggregate land in different lanes and ` +
        `race the read-modify-write cycle; whichever write loses the race is ` +
        `silently lost, and no read-time dedup recovers it (ADR-106 decision 2, ADR-100)`,
    });
  }

  if (mount.projection === "fold" && mount.collapse === "latest") {
    violations.push({
      rule: "fold-collapse-must-not-be-latest",
      message:
        `"latest" hands the handler one event out of the lane and discards the ` +
        `rest; a fold accumulates state across events, so an event it never ` +
        `sees is a contribution that never arrives — the projection undercounts ` +
        `in a way indistinguishable from sampling (ADR-106 decision 2 and 4)`,
    });
  }

  if (mount.scope === "event" && mount.collapse === "batch") {
    violations.push({
      rule: "event-scope-cannot-batch",
      message:
        `a lane scoped to a single event can never hold more than one event, so ` +
        `asking it to gather a "batch" is a no-op that reads as an optimisation ` +
        `but changes nothing at runtime (ADR-106 decision 2)`,
    });
  }

  if (mount.projection === "fold" && mount.store !== "replace") {
    violations.push({
      rule: "fold-store-must-be-replace",
      message:
        `a "fold" reads its prior state back before writing the next one; only ` +
        `a "replace" store offers that read, so a fold mounted on "${mount.store}" ` +
        `has nowhere to read its prior state from (ADR-106 decision 2)`,
    });
  }

  if (mount.projection === "map" && mount.store === "replace") {
    violations.push({
      rule: "map-store-must-not-be-replace",
      message:
        `a "map" has no accumulator, so its executor takes an append or merge ` +
        `store and nothing can run it against a "replace" one — the mount would ` +
        `validate with no executor able to execute it (ADR-107 decision 14)`,
    });
  }

  if (mount.store === "merge") {
    violations.push({
      rule: "merge-closed-to-new-adopters",
      message:
        `a "merge" store's engine (e.g. AggregatingMergeTree) combines rows by ` +
        `their sort key, so giving every write a per-record identifier — the ` +
        `usual fix for non-idempotent redelivery — would stop writes sharing a ` +
        `key from ever combining, turning the table into an append store ` +
        `wearing a rollup's name; "merge" is therefore closed to new mounts ` +
        `(ADR-106 decision 5)`,
    });

    if (mount.idempotency === undefined) {
      violations.push({
        rule: "merge-requires-idempotency",
        message:
          `a "merge" store's combination is not idempotent under redelivery — ` +
          `the engine adds a retried write on top of the original rather than ` +
          `replacing it, and nothing else stops the double count — so the mount ` +
          `must declare "idempotency" (ADR-106 decision 1, ADR-099)`,
      });
    }
  }

  return violations;
}

/**
 * Every legal `(projection, store, scope, collapse)` combination, enumerable
 * at runtime rather than implied by the absence of a violation.
 *
 * ADR-106 decision 2 calls the illegal-combinations table "exhaustive over the
 * combinations the system can express", and the Consequences section says the
 * point is that "a new store kind or scope forces a decision about every
 * existing row rather than being added quietly". A list derived by filtering
 * `validateMount`'s own output over every combination would not force that
 * decision: a new kind added to one of the `mount.types.ts` axes would simply
 * flow through the existing rules and land wherever they happen to put it,
 * silently. Keeping this list hand-authored and separate is what makes
 * `validateMount.unit.test.ts`'s exhaustiveness check actually exhaustive — if
 * a new kind is added to an axis without a row being added or removed here,
 * the cross-product test fails until someone looks at it.
 *
 * Declared `as const satisfies readonly MountShape[]` rather than typed
 * `readonly MountShape[]` outright: `satisfies` still checks every entry
 * against `MountShape`, but `as const` keeps each entry's literal type, so
 * `LegalMountShape` below is the actual union of the 13 legal combinations —
 * "the legal combinations" are a type as well as a runtime list, not just a
 * same-shaped array.
 */
export const LEGAL_MOUNT_SHAPES = [
  // A fold: only one shape is legal at all — scoped to one aggregate,
  // writing to a store that reads back, never discarding to latest. `batch`
  // is legal for a fold (it may still gather several events for the same
  // aggregate); only `latest` is forbidden, by rule fold-collapse-must-not-be-latest.
  {
    projection: "fold",
    store: "replace",
    scope: "aggregate",
    collapse: "none",
  },
  {
    projection: "fold",
    store: "replace",
    scope: "aggregate",
    collapse: "batch",
  },

  // A map: any scope, any collapse, on `append` only — `merge` is closed
  // (merge-closed-to-new-adopters) and `replace` has no executor
  // (map-store-must-not-be-replace) — except that an `event` scope
  // can never gather a `batch` (rule event-scope-cannot-batch), which removes
  // one cell per store kind.
  { projection: "map", store: "append", scope: "aggregate", collapse: "none" },
  { projection: "map", store: "append", scope: "aggregate", collapse: "batch" },
  {
    projection: "map",
    store: "append",
    scope: "aggregate",
    collapse: "latest",
  },
  { projection: "map", store: "append", scope: "event", collapse: "none" },
  { projection: "map", store: "append", scope: "event", collapse: "latest" },
  { projection: "map", store: "append", scope: "partition", collapse: "none" },
  { projection: "map", store: "append", scope: "partition", collapse: "batch" },
  {
    projection: "map",
    store: "append",
    scope: "partition",
    collapse: "latest",
  },
  { projection: "map", store: "append", scope: "global", collapse: "none" },
  { projection: "map", store: "append", scope: "global", collapse: "batch" },
  { projection: "map", store: "append", scope: "global", collapse: "latest" },
] as const satisfies readonly MountShape[];

/** The union of the 24 legal combinations, derived from {@link LEGAL_MOUNT_SHAPES}
 * rather than declared separately — two hand-written lists of the same 24
 * rows would drift the moment one of them was edited alone. */
export type LegalMountShape = (typeof LEGAL_MOUNT_SHAPES)[number];
