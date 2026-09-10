import {
  TraceWindowedReadMetrics,
  type TraceWindowedReadOutcome,
} from "../../app/trace.members.ts";
import { nowInstant } from "@langwatch/time";

/**
 * Where a windowed read's outcome is counted. A module-level sink rather than a parameter, because
 * `queryWindowed` is called from inside a dozen query bodies and threading an observer through
 * each would put the process's telemetry decision in every signature.
 */
let windowedReadMetrics: TraceWindowedReadMetrics | null = null;

function incrementWindowedReadCount(table: string, outcome: TraceWindowedReadOutcome): void {
  windowedReadMetrics?.record({ table, outcome });
}

/**
 * Half-width of the default partition-pruning window, in milliseconds. Every partition-hinted read
 * narrowed its scan to two days either side of an approximate time; shared here so adopters stop
 * copy-pasting the arithmetic. Generous on purpose, and the fallback covers correctness.
 */
export const DEFAULT_PARTITION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Lookback for the recent-first probe that partition-hint resolvers run before falling back to an
 * unbounded seek. Without a bound they walk every weekly partition's index, S3-tiered ones
 * included, turning a point seek into a cold scan. Older records pay one extra probe.
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
   * Renders the `fromUnixTimestamp64Milli` bounds for `column`. Pass the same column to the inner
   * and outer scopes of a dedup subquery so both prune to identical partitions.
   */
  sqlFor: (column: string) => string;
}

/**
 * What a windowed read does when the hinted window comes back empty, and what a hint-less read
 * runs directly. `"unbounded"` widens to a time-unbounded scan; `"none"` accepts the hinted result
 * as authoritative; `{ lookbackMs }` widens to a fixed frame, for reads clustering near now.
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
 * The window a fallback widens to: null for `"unbounded"` and `"none"`, or a fixed lookback frame
 * for `{ lookbackMs }`. The frame's upper bound carries the same clock-skew headroom as the hinted
 * path, so a client clock running slightly fast cannot push a just-written row past the ceiling.
 */
function fallbackFragment(fallback: WindowFallback, windowMs: number): WindowFragment | null {
  if (typeof fallback === "object") {
    const now = nowInstant().epochMilliseconds;

    return windowFragment(now - fallback.lookbackMs, now + windowMs);
  }

  return null;
}

export class TraceWindowedReadService {
  static create(): TraceWindowedReadService {
    return new TraceWindowedReadService();
  }

  /** Registers the process's counter. Called once, at composition. */
  static setTraceWindowedReadMetrics(port: TraceWindowedReadMetrics): void {
    windowedReadMetrics = port;
  }

  /**
   * Runs a ClickHouse read with a partition-pruning time window and a graceful fallback to a wider
   * scan, recording the outcome exactly once. With no hint it runs the fallback window directly;
   * with one it prunes, accepts a non-empty result, and widens on empty unless told not to.
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
