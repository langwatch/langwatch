/**
 * A harness a fold's own test suite calls to check that it is a function of the
 * SET of its events (ADR-098 §4, §5).
 *
 * Two properties, one check. Delivery order is best effort — telemetry is
 * stamped in a customer's process and crosses a network before we see it — so
 * folding the same events in any order must land on the same state. Delivery
 * count is best effort too: a retried job re-delivers events already applied,
 * and since no row carries a sequence to skip on, re-applying an event must
 * land on the same state as well. Both are properties to be checked, not
 * comments above the `apply` function.
 */

export interface OrderInvarianceReport {
  /** `true` iff every ordering examined folded to the same state. */
  readonly invariant: boolean;
  /**
   * How many orderings were folded and compared against the reference. Always
   * counts the identity ordering, so a report of `1` means only the identity
   * ordering was examined (either because `events` has fewer than two
   * elements, or because `maxPermutations` was capped down to it).
   */
  readonly permutationsChecked: number;
  /**
   * How many re-application orderings were folded and compared. Each is the
   * identity ordering with one event delivered a second time.
   */
  readonly duplicatesChecked: number;
  /**
   * Present only when `invariant` is false. Two orderings — given as indices
   * into `events` — that folded to different states. Reproduce the failure by
   * hand by folding `events` in `orderA`, then in `orderB`, and diffing.
   */
  readonly counterexample?: {
    readonly orderA: readonly number[];
    readonly orderB: readonly number[];
  };
  /**
   * Set only alongside a counterexample, distinguishing why it exists.
   *
   * `"order"` — two DIFFERENT orderings produced different states. This is the
   * property under test failing: the fold depends on delivery order.
   *
   * `"mutation"` — the SAME ordering (identity, folded twice from
   * independently cloned initial state) produced two different states. That
   * is not an order-sensitivity problem — `orderA` and `orderB` are identical
   * — it means `apply` is not a function of its arguments alone: it mutates
   * something it was handed (typically an event object) that leaks into the
   * next fold. A permutation sweep cannot validate a fold like that, because
   * every run corrupts the fixture the next run depends on, so this is
   * reported as its own failure mode rather than folded into `"order"`.
   *
   * `"duplication"` — re-applying one event moved the state. The fold holds a
   * delta accumulator or something else not idempotent, and a retried delivery
   * would corrupt it. The fix is never a sequence column: the delta becomes an
   * item row keyed by its natural key and the total becomes a query over those
   * rows (ADR-103).
   */
  readonly cause?: "order" | "mutation" | "duplication";
}

/**
 * Folds `events` in several orders, and again with each event duplicated, and
 * reports whether every one of them reaches the same state.
 *
 * `events.length <= 5` checks all `n!` permutations (capped by
 * `maxPermutations`). Above that, exhaustive enumeration is infeasible, so the
 * check samples a fixed, seeded sequence of orderings — deterministic on
 * purpose. A property check backed by `Math.random()` is a check that can fail
 * once, pass on retry, and teach whoever hit it that re-running is a valid
 * response to red CI; a fixed seed makes a failure reproduce every time it is
 * run, on any machine.
 *
 * The duplication sweep is exhaustive regardless of `n`: it is linear, and the
 * one non-idempotent field in a fold is exactly the field a sample would miss.
 */
export function checkOrderInvariance<State, Event>(args: {
  init: () => State;
  apply: (state: State, event: Event) => State;
  events: readonly Event[];
  /** Compare two states for domain equality. Defaults to deep structural equality. */
  equals?: (a: State, b: State) => boolean;
  /** Cap on permutations examined. Defaults to 120. */
  maxPermutations?: number;
}): OrderInvarianceReport {
  const { init, apply, events } = args;
  const equalsFn = args.equals ?? structuralEquals;
  const cap = Math.max(1, args.maxPermutations ?? 120);

  const n = events.length;
  const identity = Array.from({ length: n }, (_unused, index) => index);
  const seed = init();

  const fold = (order: readonly number[]): State => {
    let state = deepClone(seed);
    for (const index of order) {
      state = apply(state, events[index]!);
    }
    return state;
  };

  const referenceA = fold(identity);
  const referenceB = fold(identity);
  if (!equalsFn(referenceA, referenceB)) {
    return {
      invariant: false,
      permutationsChecked: 1,
      duplicatesChecked: 0,
      counterexample: { orderA: identity, orderB: identity },
      cause: "mutation",
    };
  }

  const orders =
    n <= 5 ? allPermutations(n) : sampledPermutations(n, cap);
  const capped = orders.slice(0, cap);

  let checked = 1;
  for (let i = 1; i < capped.length; i++) {
    const order = capped[i]!;
    const result = fold(order);
    checked++;
    if (!equalsFn(result, referenceA)) {
      return {
        invariant: false,
        permutationsChecked: checked,
        duplicatesChecked: 0,
        counterexample: { orderA: identity, orderB: order },
        cause: "order",
      };
    }
  }

  let duplicatesChecked = 0;
  for (const index of identity) {
    // Appended rather than inserted beside the original: that is the shape a
    // retry takes.
    const order = [...identity, index];
    const result = fold(order);
    duplicatesChecked++;
    if (!equalsFn(result, referenceA)) {
      return {
        invariant: false,
        permutationsChecked: checked,
        duplicatesChecked,
        counterexample: { orderA: identity, orderB: order },
        cause: "duplication",
      };
    }
  }

  return { invariant: true, permutationsChecked: checked, duplicatesChecked };
}

/** All `n!` permutations of `[0, n)`, identity first. Only called for `n <= 5`. */
function allPermutations(n: number): number[][] {
  if (n <= 1) return [Array.from({ length: n }, (_unused, i) => i)];
  const results: number[][] = [];
  const used = new Array<boolean>(n).fill(false);
  const current: number[] = [];
  const recurse = (): void => {
    if (current.length === n) {
      results.push(current.slice());
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      current.push(i);
      recurse();
      current.pop();
      used[i] = false;
    }
  };
  recurse();
  return results;
}

/** Fixed so the same fold examined twice samples the same orderings. */
const SAMPLE_SEED = 0x2f6e2b1;

/** mulberry32: a small deterministic PRNG. Not cryptographic — it exists only
 * to turn one fixed seed into a reproducible sequence of shuffles. */
function mulberry32(seed: number): () => number {
  let t = seed;
  return (): number => {
    t = (t + 0x6d2b79f5) | 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(order: readonly number[], rng: () => number): number[] {
  const copy = order.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

/**
 * A deterministic sample of orderings for `n > 5`, identity first, up to
 * `limit` distinct orderings. Exhaustive enumeration above 5 elements grows
 * factorially, so this trades completeness for a fixed, reproducible sweep.
 */
function sampledPermutations(n: number, limit: number): number[][] {
  const identity = Array.from({ length: n }, (_unused, i) => i);
  const rng = mulberry32(SAMPLE_SEED);
  const seen = new Set<string>([identity.join(",")]);
  const orders: number[][] = [identity];
  const attemptCap = Math.max(limit * 20, 200);
  let attempts = 0;
  while (orders.length < limit && attempts < attemptCap) {
    attempts++;
    const candidate = shuffled(identity, rng);
    const key = candidate.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    orders.push(candidate);
  }
  return orders;
}

/**
 * Deep structural equality, used unless a fold's test supplies its own.
 *
 * Handles: primitives (via `Object.is`, so `NaN` equals `NaN` and `+0` is
 * distinct from `-0`), `null` vs `undefined` (never equal to one another),
 * `Date` (compared by epoch millisecond), arrays, `Map` and `Set` (by size and
 * membership), and plain objects (by own enumerable keys, recursively).
 *
 * Deliberately does not handle: circular references (recurses without a seen
 * set — a cycle overflows the stack rather than comparing), class identity or
 * prototype chain (two differently-named classes with the same own properties
 * compare equal), non-enumerable or symbol-keyed properties, `RegExp` or typed
 * arrays, or deep equality of `Map`/`Set` keys and `Set` members (membership
 * uses `SameValueZero`, so a `Set` keyed by deep-equal-but-distinct object
 * references is reported as two different sets). A fold whose state relies on
 * any of those should pass its own `equals`.
 */
function structuralEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  if (a instanceof Date || b instanceof Date) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false;
    return a.getTime() === b.getTime();
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((value, index) => structuralEquals(value, b[index]));
  }

  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map)) return false;
    if (a.size !== b.size) return false;
    for (const [key, value] of a) {
      if (!b.has(key)) return false;
      if (!structuralEquals(value, b.get(key))) return false;
    }
    return true;
  }

  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set)) return false;
    if (a.size !== b.size) return false;
    for (const value of a) {
      if (!b.has(value)) return false;
    }
    return true;
  }

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(bRecord, key) &&
      structuralEquals(aRecord[key], bRecord[key]),
  );
}

/**
 * Deep-clones a fold's initial state before every run.
 *
 * `apply` is not assumed pure of the state it is given — a fold that mutates
 * its accumulator in place and returns it is common — so every run in this
 * module starts from its own clone of the one `init()` snapshot. Without this,
 * a mutating `apply` would corrupt the shared snapshot on the first ordering
 * folded, and every ordering after it would be compared against an
 * already-corrupted baseline rather than the true initial state, turning a
 * fine fold into a spurious counterexample.
 *
 * Handles the same shapes as `structuralEquals`: primitives, `Date`, arrays,
 * `Map`, `Set`, and plain objects, recursively. Functions and class instances
 * are copied by reference, not cloned — a fold's state is expected to be
 * plain data.
 */
function deepClone<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) {
    // `Date` is an `object`, so the branch above already excluded it from the
    // primitive return — reconstruct rather than share the mutable instance.
    return new Date(value.getTime()) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => deepClone(entry)) as T;
  }
  if (value instanceof Map) {
    const out = new Map();
    for (const [key, entry] of value) out.set(deepClone(key), deepClone(entry));
    return out as T;
  }
  if (value instanceof Set) {
    const out = new Set();
    for (const entry of value) out.add(deepClone(entry));
    return out as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = deepClone(entry);
  }
  // The loop above copies every own enumerable key of `value` onto `out`
  // through the same clone rules, so `out` has `value`'s own shape.
  return out as T;
}
