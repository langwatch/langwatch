import { incrementWindowedReadCount } from "~/server/clickhouse/metrics";

/**
 * Half-width (±) of the default partition-pruning window, in milliseconds.
 *
 * Every partition-hinted read in the codebase narrowed its scan to ±2 days
 * around an approximate trace/turn time. Shared here so adopters stop
 * copy-pasting `2 * 24 * 60 * 60 * 1000`. Generous on purpose: it dwarfs any
 * real trace duration and clock skew, so a hinted read reliably lands inside
 * the window; when it doesn't, the fallback covers correctness.
 */
export const DEFAULT_PARTITION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Lookback for the recent-first probe that partition-hint RESOLVERS run
 * before falling back to an unbounded seek.
 *
 * The resolvers (`resolveScheduledAtMs`, `resolveTraceOccurredAtMs`) exist to
 * find the partition-key value that lets the heavy read prune — but without a
 * bound of their own they walk every weekly partition's index, including
 * S3-tiered cold ones — turning a point seek into a cold scan costing whole
 * seconds. The dominant callers are worker jobs resolving minutes-old
 * aggregates, but callers may resolve records of any age: 35 days ≈ five
 * weekly partitions, comfortably on local disk, and anything older pays one
 * extra probe before the unbounded fallback answers it correctly.
 */
export const RESOLVER_RECENT_WINDOW_MS = 35 * 24 * 60 * 60 * 1000;

/**
 * The time predicate for one windowed read attempt. A `null` fragment (never a
 * `WindowFragment`) means an unbounded read — no time predicate, the wide scan.
 */
export interface WindowFragment {
  /** Inclusive lower bound, epoch ms. */
  fromMs: number;
  /** Inclusive upper bound, epoch ms. */
  toMs: number;
  /** Params for the `{fromMs:Int64}` / `{toMs:Int64}` placeholders `sqlFor` emits. */
  params: { fromMs: number; toMs: number };
  /**
   * Renders `AND <column> >= fromUnixTimestamp64Milli({fromMs:Int64}) AND
   * <column> <= fromUnixTimestamp64Milli({toMs:Int64})` for `column`. Pass the
   * same column to the inner and outer scopes of a dedup subquery so both prune
   * to identical partitions.
   */
  sqlFor: (column: string) => string;
}

/**
 * What a windowed read does when the hinted window comes back empty, and what a
 * hint-less read runs directly:
 *   - `"unbounded"` — widen to a time-unbounded scan (`null` fragment).
 *   - `"none"`      — accept the hinted result as authoritative; never widen.
 *                     (Only meaningful with a hint; hint-less reads run unbounded.)
 *   - `{ lookbackMs }` — widen to a fixed `[now - lookbackMs, now + windowMs]`
 *                     frame, for reads whose rows cluster near now (e.g. retained
 *                     recent logs) rather than near a hint.
 */
export type WindowFallback = "unbounded" | "none" | { lookbackMs: number };

export interface QueryWindowedOptions<T> {
  /** Table label for the `clickhouse_windowed_read_total{table}` metric. */
  table: string;
  /** Centre of the hinted window (epoch ms), or `null` when the caller has none. */
  hintMs: number | null;
  /** Half-width of the hinted window. Defaults to {@link DEFAULT_PARTITION_WINDOW_MS}. */
  windowMs?: number;
  /** Behaviour when the hinted read is empty / when there is no hint. */
  fallback: WindowFallback;
  /** True when `result` has no rows and (unless `fallback` is `"none"`) should widen. */
  isEmpty: (result: T) => boolean;
  /** Runs one attempt against the given window; `null` = unbounded (no predicate). */
  run: (window: WindowFragment | null) => Promise<T>;
}

function windowFragment(fromMs: number, toMs: number): WindowFragment {
  return {
    fromMs,
    toMs,
    params: { fromMs, toMs },
    sqlFor: (column) =>
      `AND ${column} >= fromUnixTimestamp64Milli({fromMs:Int64}) ` +
      `AND ${column} <= fromUnixTimestamp64Milli({toMs:Int64})`,
  };
}

/**
 * The window a fallback widens to: `null` (unbounded) for `"unbounded"`/`"none"`,
 * or a fixed lookback frame for `{ lookbackMs }`. The frame's upper bound carries
 * the same `windowMs` clock-skew headroom as the hinted path, so a client clock
 * running slightly fast can't push a just-written row past the ceiling.
 */
function fallbackFragment(
  fallback: WindowFallback,
  windowMs: number,
): WindowFragment | null {
  if (typeof fallback === "object") {
    const now = Date.now();
    return windowFragment(now - fallback.lookbackMs, now + windowMs);
  }
  return null;
}

/**
 * Runs a ClickHouse read with a partition-pruning time window and a graceful
 * fallback to a wider scan, recording the outcome on
 * `clickhouse_windowed_read_total` exactly once.
 *
 * Orchestration:
 *   - No hint (`hintMs === null`): run the fallback window directly (a lookback
 *     frame, or unbounded). Outcome `unwindowed`.
 *   - Hint present: prune to `±windowMs` around it.
 *       - Non-empty: accept it — we stayed on the cheap path. Outcome `hit`.
 *       - Empty under `fallback === "none"`: accept it without widening.
 *         Outcome `windowed_empty` — the miss is recorded as a miss, because a
 *         non-widening read has no widen outcome to surface it instead.
 *       - Empty and allowed to widen: re-run with the fallback window. Outcome
 *         `unbounded_{hit,empty}` for `"unbounded"`, `widened_{hit,empty}` for a
 *         lookback frame.
 *   - Any attempt that throws: outcome `error`, and the error is rethrown —
 *     every logical read emits exactly one outcome, failures included.
 *
 * The caller's `run` closure issues each attempt against its own resilient
 * client, so retries and error translation apply per attempt.
 */
export async function queryWindowed<T>(
  opts: QueryWindowedOptions<T>,
): Promise<T> {
  const { table, hintMs, fallback, isEmpty, run } = opts;
  const windowMs = opts.windowMs ?? DEFAULT_PARTITION_WINDOW_MS;

  try {
    if (hintMs === null) {
      const result = await run(fallbackFragment(fallback, windowMs));
      incrementWindowedReadCount(table, "unwindowed");
      return result;
    }

    return await runHintedRead({
      table,
      hintMs,
      windowMs,
      fallback,
      isEmpty,
      run,
    });
  } catch (error) {
    // A failed attempt still emits exactly one outcome — the future limiter's
    // baseline must see failures, not undercount them as absent reads.
    incrementWindowedReadCount(table, "error");
    throw error;
  }
}

/**
 * The hint-present path: prune to `±windowMs` around the hint, then apply the
 * fallback's widen policy. Split out of `queryWindowed` purely to keep the
 * outer function's outcome-recording try/catch simple; the orchestration —
 * attempt order, widen conditions, and which outcome each branch records —
 * is unchanged.
 */
async function runHintedRead<T>({
  table,
  hintMs,
  windowMs,
  fallback,
  isEmpty,
  run,
}: {
  table: string;
  hintMs: number;
  windowMs: number;
  fallback: WindowFallback;
  isEmpty: (result: T) => boolean;
  run: (window: WindowFragment | null) => Promise<T>;
}): Promise<T> {
  const hinted = await run(
    windowFragment(hintMs - windowMs, hintMs + windowMs),
  );

  // `none` treats the hinted window as authoritative (empty means genuinely
  // absent within the window), so it never widens — which also means an empty
  // result has no widen outcome to be recorded as. Give it its own: callers
  // that resolve queued work through a `none` read retry on empty, so folding
  // it into `hit` reports a permanently-failing lookup as a healthy one.
  if (fallback === "none") {
    incrementWindowedReadCount(
      table,
      isEmpty(hinted) ? "windowed_empty" : "hit",
    );
    return hinted;
  }

  // A non-empty hinted read needs no widening: it stayed cheap. Count as `hit`.
  if (!isEmpty(hinted)) {
    incrementWindowedReadCount(table, "hit");
    return hinted;
  }

  const widened = await run(fallbackFragment(fallback, windowMs));
  const isWidenedEmpty = isEmpty(widened);
  if (fallback === "unbounded") {
    incrementWindowedReadCount(
      table,
      isWidenedEmpty ? "unbounded_empty" : "unbounded_hit",
    );
  } else {
    incrementWindowedReadCount(
      table,
      isWidenedEmpty ? "widened_empty" : "widened_hit",
    );
  }
  return widened;
}
