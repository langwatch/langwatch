import type { PassRateFact } from "../report.types";

/**
 * How much a pass rate is worth believing.
 *
 * Three failures out of four is not a 75% failure rate in any sense worth
 * rewriting a prompt over, but rendered as "75%" it reads exactly like a rate
 * measured over two hundred runs. Every rate the report prints therefore
 * carries the sample it came from, and a rate measured over too little is not
 * printed as a percentage at all.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

/** 95% two-sided. */
const Z = 1.959_963_984_540_054;

/**
 * Below this many settled runs, a percentage is theatre — report the counts
 * instead. Eight is where a single flipped run stops moving the rate by more
 * than about twelve points.
 */
const MIN_SETTLED_FOR_CONCLUSION = 8;

/** Even with enough runs, an interval this wide is not telling you anything. */
const MAX_USEFUL_CI_WIDTH_POINTS = 30;

/**
 * Wilson score interval, as percentages.
 *
 * Wilson rather than the textbook normal approximation because the interesting
 * cases here sit at the ends — a criterion that passed every time, or failed
 * every time. The normal approximation collapses to a zero-width interval at
 * 0/n and n/n, which would state certainty from the two samples that most
 * warrant doubt.
 */
export function wilsonInterval({
  successes,
  total,
}: {
  successes: number;
  total: number;
}): { low: number; high: number } | null {
  if (total <= 0) return null;

  const proportion = successes / total;
  const denominator = 1 + (Z * Z) / total;
  const centre = proportion + (Z * Z) / (2 * total);
  const spread =
    Z *
    Math.sqrt(
      (proportion * (1 - proportion)) / total + (Z * Z) / (4 * total * total),
    );

  const low = Math.max(0, (centre - spread) / denominator);
  const high = Math.min(1, (centre + spread) / denominator);

  return { low: low * 100, high: high * 100 };
}

/**
 * The headline rate plus whether it can carry a conclusion.
 *
 * `value` is null when nothing has settled — the caller's own arithmetic
 * already distinguishes "we do not know yet" from "everything failed", and this
 * preserves that rather than flattening it to zero.
 */
export function buildPassRateFact({
  passedCount,
  settledCount,
}: {
  passedCount: number;
  settledCount: number;
}): PassRateFact {
  if (settledCount <= 0) {
    return {
      value: null,
      ci95: null,
      settled: 0,
      isTooFewToConclude: true,
      inconclusiveReason: "no_settled_runs",
    };
  }

  const ci95 = wilsonInterval({
    successes: passedCount,
    total: settledCount,
  });

  // Order matters: with too few runs the interval is wide *because* of the
  // sample size, so the sample is the honest thing to name. Past that, a wide
  // interval is the agent being inconsistent rather than the run being small.
  const inconclusiveReason =
    settledCount < MIN_SETTLED_FOR_CONCLUSION
      ? ("too_few_runs" as const)
      : ci95 !== null && ci95.high - ci95.low > MAX_USEFUL_CI_WIDTH_POINTS
        ? ("spread_too_wide" as const)
        : null;

  return {
    // Must equal `passRateFrom()`, the function the run-history rows use. It is
    // not called here because its other branch answers a question this one has
    // already answered above (nothing settled), and reaching for it would mean
    // fabricating the rest of a counts object to get at one division. The
    // agreement is held by a test that runs both over the same inputs, because
    // the one thing this report must never do is state a rate different from
    // the row it was exported from.
    value: (passedCount / settledCount) * 100,
    ci95,
    settled: settledCount,
    isTooFewToConclude: inconclusiveReason !== null,
    inconclusiveReason,
  };
}
