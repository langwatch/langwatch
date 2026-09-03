/**
 * Per-variant cost and duration statistics, computed at most once per row set.
 *
 * The same argument as `useBTLeaderboard`, and it now applies here for the
 * same reason: this stopped being cheap. Adding the paired difference
 * intervals made it O(variants²) bootstraps of a thousand resamples each —
 * measured at 19ms for four variants over sixty rows, but 191ms at ten and
 * 422ms at fifteen, all synchronous on the render thread.
 *
 * The compact card and the expanded drawer both need the answer for the same
 * rows, and each called `computeVariantMetrics` itself, so opening the drawer
 * paid the whole cost a second time to arrive at a value already in memory.
 * `useMemo` cannot fix that — they are siblings with separate memo caches.
 *
 * ── Keyed on CONTENT, not on the row array ──
 *
 * This was keyed on the array's identity (a WeakMap), which is free but wrong
 * while a run is live: the results page polls every second and rebuilds the
 * transformed rows from each response, so every poll produced a new array and
 * missed the cache even when no row had changed. The whole O(variants squared)
 * bootstrap then ran once a second on the render thread.
 *
 * Only the two numbers this reads are folded into the signature — cost and
 * duration per target. The outputs, which are what make a row large, are left
 * out, so the fold is integer work proportional to rows × targets rather than
 * to the size of the payload.
 */

import { useMemo } from "react";

import {
  computeVariantMetrics,
  type VariantMetrics,
} from "./batch-evaluation-results.variant-metrics";
import type { BatchResultRow } from "./batch-evaluation-results.types";

/** Bounded, because a content key has nothing to collect it. */
const MAX_CACHED_METRICS = 16;

const cache = new Map<string, Record<string, VariantMetrics>>();

/** FNV-1a, folded over the fields these statistics actually read. */
const hashInto = (hash: number, text: string): number => {
  let h = hash;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const signatureOf = (rows: BatchResultRow[]): string => {
  let h = 2166136261;
  for (const row of rows) {
    h = hashInto(h, String(row.index));
    for (const [targetId, target] of Object.entries(row.targets)) {
      h = hashInto(h, targetId);
      h = hashInto(h, String(target.cost ?? "-"));
      h = hashInto(h, String(target.duration ?? "-"));
    }
  }
  return `${rows.length}:${h}`;
};

/** Exported for tests: the memoised computation, without the React binding. */
export const variantMetricsFor = ({
  rows,
  variantIds,
}: {
  rows: BatchResultRow[];
  variantIds: string[];
}): Record<string, VariantMetrics> => {
  // Which variants are asked for changes the pairwise intervals, so it
  // belongs in the key.
  const key = `${signatureOf(rows)}|${variantIds.join(" ")}`;

  const hit = cache.get(key);
  if (hit) return hit;

  const computed = computeVariantMetrics({ variantIds, rows });

  if (cache.size >= MAX_CACHED_METRICS) {
    const oldest = cache.keys().next().value;
    if (oldest !== void 0) cache.delete(oldest);
  }
  cache.set(key, computed);
  return computed;
};

export const useVariantMetrics = ({
  rows,
  variantIds,
}: {
  rows: BatchResultRow[];
  variantIds: string[];
}): Record<string, VariantMetrics> => {
  const variantKey = variantIds.join(" ");
  return useMemo(
    () => variantMetricsFor({ rows, variantIds }),
    // The cache above is the real memo; this one just avoids re-entering it
    // on every render. `variantKey` stands in for the array identity, which
    // callers rebuild whenever the column changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, variantKey],
  );
};
