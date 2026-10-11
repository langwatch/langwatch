/**
 * A lookup by id bounded by its id index (dev/docs/plans/id-index-2026-10-10.md §4): with the
 * owner's flag on for the tenant's target, one point read of the index names the time range,
 * and the source read runs with exactly that bound. With it off, the read is `queryWindowed`.
 */
import type { IdIndexFlags, IdIndexKey, IdIndexReader, IdIndexTimeFormat } from "./idIndexFlags.ts";
import {
  DEFAULT_PARTITION_WINDOW_MS,
  fallbackFragment,
  incrementWindowedReadCount,
  queryWindowed,
  RESOLVER_RECENT_WINDOW_MS,
  type WindowFallback,
  type WindowFragment,
  windowFragment,
} from "./windowedRead.ts";

/** How far an index range is widened each side, absorbing clock skew and anchor differences. */
export const ID_INDEX_WIDEN_MS = 24 * 60 * 60 * 1000;

/** What a miss reads by default: one probe of the recent, hot partitions, never unbounded. */
export const ID_INDEX_MISS_PROBE: WindowFallback = { lookbackMs: RESOLVER_RECENT_WINDOW_MS };

export interface IndexedReadOptions<T> {
  /** Asks the target and the index: the routed client, or the fence's reader. */
  client: IdIndexReader;
  /** The owner's flags; absent reads as off, so call sites move one at a time. */
  idIndex?: IdIndexFlags | undefined;
  /** The project whose target decides the flag: its own, never a shared grant's. */
  tenantId: string;
  /** Source table label for `clickhouse_windowed_read_total`. */
  table: string;
  /** The index table, and the ids looked up in it. */
  index: string;
  key: IdIndexKey;
  timeFormat?: IdIndexTimeFormat | undefined;
  /** A time the caller already has; today's hinted read runs first. */
  hintMs?: number | null | undefined;
  windowMs?: number | undefined;
  /** Today's fallback, kept whenever the index is not trusted. */
  fallback: WindowFallback;
  /** What an id the index has never seen reads: the recent probe unless told otherwise. */
  onMiss?: WindowFallback | undefined;
  isEmpty: (result: T) => boolean;
  run: (window: WindowFragment | null) => Promise<T>;
}

/** The bound a hit reads with: the index range widened a day each side, clamped to valid ms. */
export function indexWindow({ fromMs, toMs }: { fromMs: number; toMs: number }): WindowFragment {
  return windowFragment(
    Math.max(0, fromMs - ID_INDEX_WIDEN_MS),
    Math.min(Number.MAX_SAFE_INTEGER, toMs + ID_INDEX_WIDEN_MS),
  );
}

/**
 * Reads by id: a given time first; then, flag on, the index's range (`index_hit`) or, for an
 * unseen id, the miss probe (`index_miss`); flag off, today's windowed read unchanged. Every
 * path counts exactly one outcome.
 */
export async function indexedRead<T>(options: IndexedReadOptions<T>): Promise<T> {
  const { client, idIndex, tenantId, table, fallback, isEmpty, run } = options;
  const hintMs = options.hintMs ?? null;
  const windowMs = options.windowMs ?? DEFAULT_PARTITION_WINDOW_MS;
  const trusted =
    idIndex !== undefined && idIndex.isOn({ target: await client.targetOf({ tenantId }) });
  if (!trusted) return queryWindowed({ table, hintMs, windowMs, fallback, isEmpty, run });

  try {
    if (hintMs !== null) {
      const hinted = await run(windowFragment(hintMs - windowMs, hintMs + windowMs));
      if (!isEmpty(hinted)) {
        incrementWindowedReadCount(table, "hit");
        return hinted;
      }
    }
    const bounds = await client.indexBounds({
      tenantId,
      index: options.index,
      key: options.key,
      timeFormat: options.timeFormat,
    });
    if (bounds.n === 0) {
      const probed = await run(fallbackFragment(options.onMiss ?? ID_INDEX_MISS_PROBE, windowMs));
      incrementWindowedReadCount(table, "index_miss");
      return probed;
    }
    const result = await run(indexWindow(bounds));
    incrementWindowedReadCount(table, "index_hit");
    return result;
  } catch (error) {
    incrementWindowedReadCount(table, "error");
    throw error;
  }
}
