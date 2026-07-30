import type { Event } from "../domain/types";
import type { FoldProjectionDefinition } from "./foldProjection.types";

/**
 * Proving a fold reaches the same state whichever order its events arrive in.
 *
 * OPT-IN, deliberately. `refoldOnOutOfOrder: false` is a fold asserting exactly
 * this property about itself, and on most of the folds that set it the assertion
 * has never been checked — the same shape as the `simulationRunState` bug.
 * Turning the property into a gate today would fail most folds at once, so this
 * is a harness plus a shrink-only list (see the accompanying ratchet test): the
 * gap is visible and shrinking rather than invisible and asserted.
 *
 * It CANNOT be a deep equality on the folded state.
 * `AbstractFoldProjection.apply` stamps `updatedAt = max(Date.now(), prev + 1)`
 * on every apply, so two orderings of the same events differ in `updatedAt` by
 * construction and a naive shuffle-and-compare fails every fold immediately.
 * The comparison is therefore an explicit VIEW: named invariants the caller
 * declares, so what is being claimed is written down rather than implied by
 * whatever happens to be on the state object.
 */
export interface OrderInvariant<State> {
  /** What is being claimed, named so a failure says which claim broke. */
  readonly name: string;
  /**
   * The value that must not depend on arrival order. Use a plain value for
   * scalars, a sorted array for anything order-insensitive but list-shaped
   * (`traceIds`, `filesTouched`, `skills`, `mcpServers`), and `Math.max` for a
   * checkpoint like `LastEventOccurredAt`.
   */
  readonly of: (state: State) => unknown;
}

/** Sorted copy, for a list whose membership matters and whose order does not. */
export function asSet(values: readonly string[]): string[] {
  return [...values].sort();
}

/**
 * Below this many events every ordering is checked; above it, orderings are
 * sampled. 7! is 5040 folds, which is fast; 8! is 40320, which is not.
 */
const EXHAUSTIVE_UP_TO = 7;

export interface OrderInvarianceResult {
  /** How many orderings were folded, including the reference. */
  readonly orderings: number;
  readonly exhaustive: boolean;
}

/**
 * Folds `events` in every (or a sample of every) order and asserts each named
 * invariant holds identically.
 *
 * Throws naming the invariant, the value it took, and the ordering that
 * produced it — an ordering is only useful as a reproduction if it is printed.
 */
export function assertOrderInvariant<State, E extends Event>({
  projection,
  events,
  invariants,
  samples = 200,
  seed = 1,
}: {
  projection: FoldProjectionDefinition<State, E>;
  events: readonly E[];
  invariants: readonly OrderInvariant<State>[];
  samples?: number;
  seed?: number;
}): OrderInvarianceResult {
  if (invariants.length === 0) {
    throw new Error(
      "assertOrderInvariant: declare at least one invariant — a run with none proves nothing.",
    );
  }

  const fold = (ordering: readonly E[]): State => {
    let state = projection.init();
    for (const event of ordering) state = projection.apply(state, event);
    return state;
  };

  const reference = fold(events);
  const expected = invariants.map((invariant) => invariant.of(reference));

  const exhaustive = events.length <= EXHAUSTIVE_UP_TO;
  const orderings = exhaustive
    ? permutations(events)
    : shuffles(events, samples, seed);

  let checked = 0;
  for (const ordering of orderings) {
    checked++;
    const state = fold(ordering);
    invariants.forEach((invariant, index) => {
      const actual = invariant.of(state);
      if (sameValue(actual, expected[index])) return;
      throw new Error(
        `Fold "${projection.name}" is not order-invariant: "${invariant.name}" was ` +
          `${JSON.stringify(expected[index])} in declared order and ${JSON.stringify(actual)} under ` +
          `[${ordering.map((event) => `${event.type}#${event.id}`).join(", ")}].`,
      );
    });
  }

  return { orderings: checked, exhaustive };
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function* permutations<T>(values: readonly T[]): Generator<readonly T[]> {
  if (values.length <= 1) {
    yield values;
    return;
  }
  for (let index = 0; index < values.length; index++) {
    const rest = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const tail of permutations(rest)) {
      yield [values[index]!, ...tail];
    }
  }
}

/** Deterministic shuffles, so a failure reproduces from the seed alone. */
function* shuffles<T>(
  values: readonly T[],
  count: number,
  seed: number,
): Generator<readonly T[]> {
  let state = seed >>> 0 || 1;
  const next = (): number => {
    // xorshift32 — small, deterministic, and adequate for spreading orderings.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };

  for (let run = 0; run < count; run++) {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const swap = Math.floor(next() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
    }
    yield shuffled;
  }
}
