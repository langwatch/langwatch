import {
  TraceWindowedReadMetricsPort,
  type TraceWindowedReadOutcome,
} from "../ports/trace-windowed-read-metrics.port";

/**
 * Where a windowed read's outcome is counted. A module-level sink rather than a parameter because `TraceWindowedReadService.queryWindowed` is a free function called from inside a dozen query bodies, and threading an observer through every one would put the process's telemetry decision in every signature. The platform app held a Prometheus counter here at exactly the same lifetime; now the counter is the PROCESS's, registered once at composition, and a package that composes none counts nothing rather than opening a registry of its own.
 */
let windowedReadMetrics: TraceWindowedReadMetricsPort | null = null;

function incrementWindowedReadCount(table: string, outcome: TraceWindowedReadOutcome): void {
  windowedReadMetrics?.record({ table, outcome });
}

/**
 * Half-width (±) of the default partition-pruning window, in milliseconds. Every partition-hinted read in the codebase narrowed its scan to ±2 days around an approximate trace/turn time; shared here so adopters stop copy-pasting `2 * 24 * 60 * 60 * 1000`. Generous on purpose: it dwarfs any real trace duration and clock skew, so a hinted read reliably lands inside the window, and when it doesn't the fallback covers correctness.
 */
export const DEFAULT_PARTITION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Lookback for the recent-first probe that partition-hint RESOLVERS run before falling back to an unbounded seek. The resolvers exist to find the partition-key value that lets the heavy read prune — but without a bound of their own they walk every weekly partition's index, including S3-tiered cold ones, turning a point seek into a cold scan costing whole seconds. Dominant callers are worker jobs resolving minutes-old aggregates, but callers may resolve records of any age: 35 days ≈ five weekly partitions, comfortably on local disk, and anything older pays one extra probe before the unbounded fallback answers it correctly.
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
   * Renders `AND <column> >= fromUnixTimestamp64Milli({fromMs:Int64}) AND <column> <= fromUnixTimestamp64Milli({toMs:Int64})` for `column`. Pass the same column to the inner and outer scopes of a dedup subquery so both prune to identical partitions.
   */
  sqlFor: (column: string) => string;
}

/**
 * What a windowed read does when the hinted window comes back empty, and what a hint-less read runs directly: `"unbounded"` widens to a time-unbounded scan; `"none"` accepts the hinted result as authoritative and never widens (only meaningful with a hint — hint-less reads run unbounded); `{ lookbackMs }` widens to a fixed `[now - lookbackMs, now + windowMs]` frame, for reads whose rows cluster near now (e.g. retained recent logs) rather than near a hint.
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
 * The window a fallback widens to: `null` (unbounded) for `"unbounded"`/`"none"`, or a fixed lookback frame for `{ lookbackMs }`. The frame's upper bound carries the same `windowMs` clock-skew headroom as the hinted path, so a client clock running slightly fast can't push a just-written row past the ceiling.
 */
function fallbackFragment(fallback: WindowFallback, windowMs: number): WindowFragment | null {
  if (typeof fallback === "object") {
    const now = Date.now();

    return windowFragment(now - fallback.lookbackMs, now + windowMs);
  }

  return null;
}

export class TraceWindowedReadService {
  static create(): TraceWindowedReadService {
    return new TraceWindowedReadService();
  }

  /** Registers the process's counter. Called once, at composition. */
  static setTraceWindowedReadMetrics(port: TraceWindowedReadMetricsPort): void {
    windowedReadMetrics = port;
  }

  /**
   * Runs a ClickHouse read with a partition-pruning time window and a graceful fallback to a wider scan, recording the outcome on `clickhouse_windowed_read_total` exactly once. No hint: runs the fallback window directly, outcome `unwindowed`. Hint present: prunes to `±windowMs`; non-empty accepts it (`hit`); empty under `fallback === "none"` accepts without widening (`windowed_empty`); empty and allowed to widen re-runs with the fallback window (`unbounded_{hit,empty}` or `widened_{hit,empty}`). Any attempt that throws emits outcome `error` and rethrows — every logical read emits exactly one outcome, failures included. The caller's `run` closure issues each attempt against its own resilient client, so retries and error translation apply per attempt.
   */
  static async queryWindowed<T>(opts: QueryWindowedOptions<T>): Promise<T> {
    const { table, hintMs, fallback, isEmpty, run } = opts;
    const windowMs = opts.windowMs ?? DEFAULT_PARTITION_WINDOW_MS;

    try {
      if (hintMs === null) {
        const result = await run(fallbackFragment(fallback, windowMs));
        incrementWindowedReadCount(table, "unwindowed");

        return result;
      }

      const hinted = await run(windowFragment(hintMs - windowMs, hintMs + windowMs));

      // `none` treats the hinted window as authoritative (empty means genuinely
      // absent within the window), so it never widens — which also means an empty
      // result has no widen outcome to be recorded as. Give it its own: callers
      // that resolve queued work through a `none` read retry on empty, so folding
      // it into `hit` reports a permanently-failing lookup as a healthy one.
      if (fallback === "none") {
        incrementWindowedReadCount(table, isEmpty(hinted) ? "windowed_empty" : "hit");

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
        incrementWindowedReadCount(table, isWidenedEmpty ? "unbounded_empty" : "unbounded_hit");
      } else {
        incrementWindowedReadCount(table, isWidenedEmpty ? "widened_empty" : "widened_hit");
      }

      return widened;
    } catch (error) {
      // A failed attempt still emits exactly one outcome — the future limiter's
      // baseline must see failures, not undercount them as absent reads.
      incrementWindowedReadCount(table, "error");

      throw error;
    }
  }
}
