/**
 * The leaderboard for a comparison column, computed at most once per column.
 *
 * The fit is not cheap — a thousand bootstrap resamples over an MM solve that
 * is O(n²) per iteration, all synchronous on the render thread. The compact
 * card on the results page and the expanded drawer each need the same answer
 * for the same column, and each used to call `computeBTLeaderboard` itself, so
 * opening the drawer paid the whole cost a second time to arrive at a value
 * already sitting in memory.
 *
 * `useMemo` cannot fix that: the two components are siblings with separate
 * memo caches. Hoisting the state would mean threading it through the chart
 * grid to a drawer mounted elsewhere in the tree. A cache shared at module
 * level is the smaller change and survives both components unmounting.
 *
 * ── Keyed on CONTENT, not on the column object ──
 *
 * This was keyed on the column's identity (a WeakMap), which is free but wrong
 * while a run is live. The results page polls every second and rebuilds the
 * transformed data from each response, so every poll produces a new column
 * object — and a new object misses an identity cache even when the run
 * produced no new verdict at all. The full fit then ran once a second,
 * synchronously, on the render thread, for as long as someone watched the run:
 * around 18ms/s at four variants, but around 500ms/s at fifteen.
 *
 * The signature below is a fold over the verdicts — integer work proportional
 * to rows × candidates, orders of magnitude cheaper than the resampling it
 * avoids. An earlier note here argued that hashing the contents would cost a
 * slice of what the cache saves. That is true of the reasoning STRINGS, which
 * are large and are deliberately left out; the row index, the winner and the
 * candidate ids are all the fit reads.
 *
 * A poll that genuinely delivered a new verdict still recomputes — that work
 * is real. What is gone is paying for it again when nothing changed.
 */

import { useMemo } from "react";
import { buildPairwiseComparisons } from "./buildPairwiseComparisons";
import {
  type BTLeaderboard,
  type BTLeaderboardOptions,
  computeBTLeaderboard,
} from "./computeBTLeaderboard";
import type { BatchComparisonColumn } from "./types";

/**
 * Fits to keep. A results page shows a handful of comparison columns and a
 * reader switching between runs wants the previous one still warm. Bounded
 * because a content key, unlike a WeakMap, has nothing to collect it.
 */
const MAX_CACHED_FITS = 16;

const cache = new Map<string, BTLeaderboard>();

/** FNV-1a, folded over the fields the fit actually reads. */
const hashInto = (hash: number, text: string): number => {
  let h = hash;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/**
 * Identifies the fit this column would produce.
 *
 * Excludes `reasoning` deliberately: it is by far the largest field on a
 * verdict, the fit never reads it, and a judge cannot reword it without also
 * changing one of the fields that ARE folded in.
 */
const signatureOf = (column: BatchComparisonColumn): string => {
  let h = 2166136261;
  h = hashInto(h, column.evaluatorId);
  for (const verdict of Object.values(column.verdictsByRow)) {
    h = hashInto(h, String(verdict.rowIndex));
    h = hashInto(h, verdict.winnerId ?? "-");
    h = hashInto(h, verdict.isUnresolved ? "u" : "-");
    for (const id of verdict.candidateIds ?? []) h = hashInto(h, id);
  }
  return `${column.evaluatorId}:${h}`;
};

/** Exported for tests: the memoised fit, without the React binding. */
export const leaderboardFor = ({
  column,
  variantIds,
  options,
}: {
  column: BatchComparisonColumn;
  variantIds: string[];
  options?: BTLeaderboardOptions;
}): BTLeaderboard => {
  // Variant order changes the tie-break between equal scores, so it belongs in
  // the key. Options do too — a caller asking for a different resample count
  // must not be handed a fit made under the old one.
  const key = `${signatureOf(column)}|${variantIds.join("\u0000")}|${JSON.stringify(options ?? {})}`;

  const hit = cache.get(key);
  if (hit) return hit;

  const computed = computeBTLeaderboard({
    comparisons: buildPairwiseComparisons(column),
    variantIds,
    ...options,
  });

  // Oldest-inserted eviction. `Map` preserves insertion order, so the first
  // key is the least recently added — enough for a cache this size, and it
  // avoids the per-read bookkeeping a true LRU would need.
  if (cache.size >= MAX_CACHED_FITS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, computed);
  return computed;
};

export const useBTLeaderboard = ({
  column,
  variantIds,
  options,
}: {
  column: BatchComparisonColumn;
  variantIds: string[];
  options?: BTLeaderboardOptions;
}): BTLeaderboard => {
  const variantKey = variantIds.join("\u0000");
  return useMemo(
    () => leaderboardFor({ column, variantIds, options }),
    // The cache above is the real memo; this one just avoids re-entering it
    // on every render. `variantKey` stands in for the array identity, which
    // callers rebuild each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [column, variantKey, JSON.stringify(options ?? {})],
  );
};
