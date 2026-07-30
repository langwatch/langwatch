/**
 * The dispatch plane's group key (ADR-100).
 *
 * A group key decides which lane a unit of work is queued into, and lanes are
 * processed independently of one another. That makes it the concurrency
 * contract of the whole system: it determines both what is ordered relative to
 * what, and what may be batched with what. Neither property is legible when the
 * key is a concatenated string, which is why it is a typed descriptor rendered
 * by one function rather than assembled at call sites.
 */

/**
 * Which processing lane the work belongs to. The lane separates unrelated work
 * on the same domain object — a fold and a subscriber reacting to the same
 * event must not contend, so they are never in the same group.
 */
export type Lane =
  | { readonly kind: "fold"; readonly name: string }
  | { readonly kind: "map"; readonly name: string }
  | { readonly kind: "subscriber"; readonly name: string }
  | { readonly kind: "processManager"; readonly name: string }
  /**
   * A command lane. Omitting `name` serialises every command type for one
   * aggregate into a single lane; naming it lets different command types for
   * the same aggregate run concurrently.
   */
  | { readonly kind: "command"; readonly name?: string }
  | { readonly kind: "job"; readonly name: string };

/**
 * How wide a lane is — the single most consequential choice in the system.
 *
 * `scope` declares the ordering contract and the batching contract at once,
 * because they are the same thing seen from two sides: work in one lane is
 * processed one item at a time in queue order, and only work in one lane can be
 * coalesced into a single store write.
 */
export type Scope =
  /**
   * One lane per aggregate. Required for folds — a fold reads prior state and
   * writes it back, so two lanes touching one aggregate would interleave
   * read-modify-write cycles and lose updates.
   */
  | {
      readonly kind: "aggregate";
      readonly aggregateType: string;
      readonly aggregateId: string;
    }
  /**
   * One lane per event: maximum parallelism, and no batch can ever form,
   * because a batch is drawn from a single lane. Correct for genuinely
   * independent per-event writes; wrong for anything that wants to coalesce.
   */
  | { readonly kind: "event"; readonly eventId: string }
  /**
   * One lane per declared partition — the batching unit, named explicitly.
   * `parts` is an ordered list of dimension values, e.g. a trace id and a time
   * bucket. Rendering escapes each part, so a value containing the separator
   * cannot collide with a different part list.
   */
  | { readonly kind: "partition"; readonly parts: readonly string[] }
  /**
   * One lane for this tenant and lane. Deliberately verbose to write, because
   * it removes all parallelism within the tenant for that lane.
   */
  | { readonly kind: "global" };

/**
 * A fully-determined group key. `tenantId` is always present and always leads
 * the rendered key, so no scope — `global` included — can place two tenants'
 * work in one lane.
 */
export interface GroupKey {
  readonly tenantId: string;
  readonly lane: Lane;
  readonly scope: Scope;
}

/** Lanes whose work reads prior state and writes it back. */
export type StatefulLaneKind = "fold";

/**
 * The scope a stateful lane is required to use. Expressed as a type so a fold
 * mounted on any other scope fails to compile rather than losing updates in
 * production.
 */
export type StatefulScope = Extract<Scope, { kind: "aggregate" }>;

export interface StatefulGroupKey extends GroupKey {
  readonly lane: Extract<Lane, { kind: StatefulLaneKind }>;
  readonly scope: StatefulScope;
}
