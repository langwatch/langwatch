/**
 * Per-variant cost and duration statistics, computed at most once per row set.
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
