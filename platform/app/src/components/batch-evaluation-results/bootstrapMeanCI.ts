/**
 * A confidence interval for a mean cost or duration (#5103).
 *
 * The trade-off chart was asymmetric about uncertainty: the quality axis
 * carried an interval while cost was drawn as an exact point. Cost is a MEAN
 * OVER ROWS, and rows vary enormously — one long answer can move it — so a
 * bare dot claims a precision the run does not have, in the same breath as
 * the y axis admits it does not.
 *
 * ── Why bootstrap rather than mean ± 1.96·SE ──
 *
 * Two reasons, and the second is the one that decides it.
 *
 * The normal approximation leans on the CLT, and per-row cost is strongly
 * right-skewed — a few expensive rows and a floor at zero. At the sample
 * sizes here that is exactly where the approximation is least trustworthy,
 * and it can put the lower bound below zero, which is not a possible cost.
 *
 * More importantly, the score interval on the other axis is a bootstrap
 * percentile interval. Drawing one arm of a glyph from a bootstrap and the
 * other from a normal approximation would make the two arms different kinds
 * of statement while looking like one shape. Same method, same meaning:
 * "where the true mean lies".
 *
 * Deliberately NOT the interquartile range, which is what a box plot would
 * show. The IQR is the spread of the underlying rows — a different quantity
 * — and pairing it with a confidence interval on the other axis would imply
 * they are comparable. The IQR is also far wider, so the chart would suggest
 * the cost is much less pinned down than it is.
 */

import { mulberry32 } from "./mulberry32";

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

/** R's type-7 quantile, matching the score bootstrap's interpolation. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  const frac = pos - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}
