/**
 * The p95 of the values a table page is actually showing, used to scale a
 * row's inline comparison bar against its own peers rather than against an
 * absolute ceiling nobody knows.
 *
 * Zeroes are excluded: a page of mostly empty rows would otherwise drag the
 * percentile to nothing and paint every real value as an outlier.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */

/**
 * Fewer than this many values carrying something, and no bar is drawn at all.
 * Two points describe no distribution, so a bar over them would be a shape
 * with no meaning rather than a comparison.
 */
export const MIN_VALUES_FOR_PERCENTILE = 3;

export interface PercentileStats {
  /** The 95th percentile of the non-zero values, by nearest rank. */
  p95: number;
  /** Whether there were enough values for the percentile to mean anything. */
  hasStats: boolean;
}

export function percentileStats(values: number[]): PercentileStats {
  const present = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (present.length < MIN_VALUES_FOR_PERCENTILE) {
    return { p95: 0, hasStats: false };
  }
  // Nearest rank: the smallest value at or above which 95% of the sample sits.
  const rank = Math.ceil(present.length * 0.95);
  const index = Math.min(present.length - 1, Math.max(0, rank - 1));
  return { p95: present[index]!, hasStats: true };
}
