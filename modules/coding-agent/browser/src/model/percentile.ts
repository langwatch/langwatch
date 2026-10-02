/** P95 excluding zeroes; scales row's comparison bar against visible peers. */

/** No bar drawn below this many non-zero values (two points describe no distribution). */
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
    .toSorted((a, b) => a - b);
  if (present.length < MIN_VALUES_FOR_PERCENTILE) {
    return { p95: 0, hasStats: false };
  }
  // Nearest rank: the smallest value at or above which 95% of the sample sits.
  const rank = Math.ceil(present.length * 0.95);
  const index = Math.min(present.length - 1, Math.max(0, rank - 1));
  return { p95: present[index]!, hasStats: true };
}
