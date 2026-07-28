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
 * Keyed by the row array's IDENTITY (WeakMap) rather than a hash of its
 * contents: the rows are large, hashing them would cost a slice of what the
 * cache saves, and the array is already stable for as long as the run's
 * results are. When it is replaced the entry becomes unreachable with it.
 */

import { useMemo } from "react";

import {
  computeVariantMetrics,
  type VariantMetrics,
} from "./computeVariantMetrics";
import type { BatchResultRow } from "./types";

const cache = new WeakMap<
  BatchResultRow[],
  Map<string, Record<string, VariantMetrics>>
>();

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
  const key = variantIds.join(" ");

  let byKey = cache.get(rows);
  if (!byKey) {
    byKey = new Map();
    cache.set(rows, byKey);
  }

  const hit = byKey.get(key);
  if (hit) return hit;

  const computed = computeVariantMetrics({ variantIds, rows });
  byKey.set(key, computed);
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
