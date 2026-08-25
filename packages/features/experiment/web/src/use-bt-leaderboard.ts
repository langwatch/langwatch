/**
 * Shared, bounded cache for the synchronous bootstrap fit. Sibling components
 * cannot share `useMemo`, and polling rebuilds column objects each second.
 *
 * The key folds only evidence read by the fit, not potentially large judge
 * reasoning, so unchanged responses reuse the result while new verdicts do not.
 */

import { useMemo } from "react";
import { buildPairwiseComparisons } from "./batch-evaluation-results.pairwise";
import {
  type BTLeaderboard,
  type BTLeaderboardOptions,
  computeBTLeaderboard,
} from "./batch-evaluation-results.bt-leaderboard";
import type { BatchComparisonColumn } from "./batch-evaluation-results.types";

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
    h = hashInto(h, verdict.isUnsettled ? "s" : "-");
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
    if (oldest !== void 0) cache.delete(oldest);
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
