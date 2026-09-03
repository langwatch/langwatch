/**
 * Percentile CI for mean cost or duration. Per-row cost is right-skewed and
 * bounded at zero, so a normal interval is misleading at these sample sizes.
 *
 * Quality uses the same bootstrap method: chart axes must express the same
 * quantity. This is not an IQR, which describes row spread rather than
 * uncertainty in the mean.
 */

import { mulberry32 } from "./random.mulberry32";
import { quantile } from "./batch-evaluation-results.metric-stats";

/** Resamples per interval. Matches the score bootstrap for the same reason. */
const DEFAULT_SAMPLES = 1000;

export const bootstrapMeanCI = ({
  values,
  samples = DEFAULT_SAMPLES,
  seed = 1,
}: {
  values: number[];
  samples?: number;
  seed?: number;
}): [number, number] | null => {
  // One observation has no spread to resample: every replicate is that same
  // value, so the interval would come out zero-width and read as certainty.
  // Refusing is the honest output.
  if (values.length < 2) return null;
  if (!values.every((v) => Number.isFinite(v))) return null;

  const rand = mulberry32(seed);
  const n = values.length;
  const means: number[] = [];

  for (let b = 0; b < samples; b++) {
    let total = 0;
    for (let k = 0; k < n; k++) {
      total += values[Math.floor(rand() * n)]!;
    }
    means.push(total / n);
  }

  means.sort((a, b) => a - b);
  return [quantile(means, 0.025), quantile(means, 0.975)];
};
