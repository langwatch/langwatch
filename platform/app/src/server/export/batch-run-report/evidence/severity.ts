import type {
  FailureSignature,
  Severity,
  TrendClassification,
} from "../report.types";

/**
 * How much a failure mode matters, computed without a model.
 *
 * Ordering a failure list by how many rows are red puts a cosmetic criterion
 * that trips on every scenario above a serious one that trips on a single
 * important path. This is the deterministic prior that gives the report a
 * defensible order even when no model is available, and a second opinion to
 * disagree with when one is.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

/** Score thresholds, highest first. */
const SEVERITY_BANDS: { atLeast: number; severity: Severity }[] = [
  { atLeast: 5, severity: "critical" },
  { atLeast: 3, severity: "high" },
  { atLeast: 2, severity: "medium" },
];

/** Proportion of the run a failure has to touch before it counts as widespread. */
const WIDESPREAD_SHARE = 0.5;
const NOTABLE_SHARE = 0.2;

/**
 * A run that stalled or errored never reached the judge, so it says nothing
 * about the agent. It still matters — your suite is not measuring what you
 * think it is — but it is a different problem from a failure, and letting it
 * outrank one buries the findings somebody can act on.
 */
const INFRASTRUCTURE_CEILING: Severity = "medium";

const SEVERITY_ORDER: Severity[] = ["low", "medium", "high", "critical"];

export function computeSeverityPrior({
  signature,
  trendByCriterion,
  settledRuns,
}: {
  signature: FailureSignature;
  trendByCriterion: Map<string, TrendClassification>;
  settledRuns: number;
}): Severity {
  let score = signature.kind === "judged" ? 2 : 0;

  score += blastRadiusScore({
    affectedRuns: signature.runIds.length,
    settledRuns,
  });

  // The same failure across several different scenarios is a property of the
  // agent; the same failure across repeats of one scenario may just be one
  // brittle path.
  if (signature.scenarioIds.length > 1) score += 1;

  score += trendScore({
    classifications: signature.unmetCriterionIds.map((criterionId) =>
      trendByCriterion.get(criterionId),
    ),
  });

  const severity = bandFor(score);

  return signature.kind === "judged"
    ? severity
    : capAt({ severity, ceiling: INFRASTRUCTURE_CEILING });
}

function blastRadiusScore({
  affectedRuns,
  settledRuns,
}: {
  affectedRuns: number;
  settledRuns: number;
}): number {
  if (settledRuns <= 0) return 0;
  const share = affectedRuns / settledRuns;
  if (share >= WIDESPREAD_SHARE) return 2;
  if (share >= NOTABLE_SHARE) return 1;
  return 0;
}

/**
 * A criterion that has failed for a long time is a known debt; one that broke
 * since the last run is a fresh change somebody can still connect to a cause.
 * Both are raised. A criterion that keeps flapping is lowered — acting on it
 * means chasing something that will pass again on its own.
 */
function trendScore({
  classifications,
}: {
  classifications: (TrendClassification | undefined)[];
}): number {
  let score = 0;
  if (classifications.some((it) => it === "regression")) score += 2;
  if (classifications.some((it) => it === "long_standing")) score += 1;
  if (
    classifications.length > 0 &&
    classifications.every((it) => it === "unreliable")
  ) {
    score -= 1;
  }
  return score;
}

function bandFor(score: number): Severity {
  return (
    SEVERITY_BANDS.find((band) => score >= band.atLeast)?.severity ?? "low"
  );
}

function capAt({
  severity,
  ceiling,
}: {
  severity: Severity;
  ceiling: Severity;
}): Severity {
  return SEVERITY_ORDER.indexOf(severity) > SEVERITY_ORDER.indexOf(ceiling)
    ? ceiling
    : severity;
}

/** Most severe first; ties keep their incoming order. */
/**
 * A severity as a number, worst highest.
 *
 * The rendered table sorts on `sortValue`, and the client comparator only
 * takes its numeric path when both keys parse as numbers - so handing it the
 * severity *word* sorts "critical" before "low" alphabetically and destroys
 * the one ordering that section exists to provide.
 */
export function severityRank(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

export function bySeverityDescending(a: Severity, b: Severity): number {
  return SEVERITY_ORDER.indexOf(b) - SEVERITY_ORDER.indexOf(a);
}
