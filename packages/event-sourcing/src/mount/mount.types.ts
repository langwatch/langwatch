/**
 * The mount descriptor (ADR-106 decision 1).
 *
 * Everything a projection needs to declare travels together, so one function
 * — `validateMount` — can check the whole thing at once rather than three
 * separate call sites each holding a fragment of the rule.
 *
 * The four axes below are declared as `const` arrays first and the field
 * types are *derived* from them (`(typeof X)[number]`), rather than the other
 * way round. That is not a style preference: `validateMount.ts` builds its
 * exhaustiveness test by iterating these same arrays, so a new value added to
 * one of them is picked up by that test automatically. Writing the union
 * inline on `Mount` instead would let a new scope or store kind compile
 * everywhere it is used without the legality table ever being asked about it
 * — exactly the silent addition ADR-106 exists to prevent.
 */

/** The two projection kinds (ADR-098). */
export const PROJECTION_KINDS = ["fold", "map"] as const;
export type ProjectionKind = (typeof PROJECTION_KINDS)[number];

/** The three store kinds, and what each does when two records share a key
 * (ADR-099): `append` keeps both, `replace` keeps the newest, `merge`
 * combines them. */
export const STORE_KINDS = ["append", "replace", "merge"] as const;
export type StoreKind = (typeof STORE_KINDS)[number];

/** How wide a lane is (ADR-100). */
export const SCOPE_KINDS = [
  "aggregate",
  "event",
  "partition",
  "global",
] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/**
 * `batch` hands a handler every event in the lane; `latest` hands it one and
 * discards the rest. They are opposites, not variants of one knob (ADR-106
 * decision 4) — naming them as settings of the same enum is what let a fold
 * be configured with a discarding one in the first place.
 */
export const COLLAPSE_KINDS = ["none", "batch", "latest"] as const;
export type CollapseKind = (typeof COLLAPSE_KINDS)[number];

/**
 * How a redelivered write avoids double counting against a `merge` store.
 * Required precisely because `merge`'s combination is the one store contract
 * that is not idempotent under redelivery (ADR-099).
 */
export const IDEMPOTENCY_KINDS = [
  "upstream-exactly-once",
  "whole-bucket-replace",
] as const;
export type Idempotency = (typeof IDEMPOTENCY_KINDS)[number];

/**
 * A mount descriptor.
 *
 * `idempotency` is encoded as a discriminated union on `store` rather than a
 * plain optional field: a `merge` mount is required to carry it, and a
 * non-`merge` mount is refused for carrying one at all ("Required when
 * `store` is `merge`; refused otherwise" — ADR-106 decision 1). That half of
 * the field's contract is exactly the kind of thing the ADR's own rationale
 * calls "expressible in the type system", so it is enforced here rather than
 * left to `validateMount` to notice.
 *
 * The other four fields stay flat string unions: whether a given `scope` and
 * `collapse` combination is sound is not a fact about one field in isolation,
 * so `validateMount` is where that lives (ADR-106 decision 2, and the
 * "Rationale" section's "some of these are expressible in the type system and
 * some are not").
 */
export type Mount = {
  readonly projection: ProjectionKind;
  readonly scope: ScopeKind;
  readonly collapse: CollapseKind;
} & (
  | {
      readonly store: Exclude<StoreKind, "merge">;
      readonly idempotency?: undefined;
    }
  | {
      readonly store: Extract<StoreKind, "merge">;
      readonly idempotency: Idempotency;
    }
);

/**
 * The four fields decision 2's table is a statement about, with `idempotency`
 * dropped. `idempotency` is a per-field contract (see `Mount` above), not part
 * of the combination table, so it plays no role in whether a *shape* is legal.
 */
export interface MountShape {
  readonly projection: ProjectionKind;
  readonly store: StoreKind;
  readonly scope: ScopeKind;
  readonly collapse: CollapseKind;
}

/** One reason a mount is refused: a stable identifier plus a runtime-facing
 * explanation, never just "invalid combination". */
export interface MountViolation {
  readonly rule: string;
  readonly message: string;
}
