import { formatCost, formatDuration } from "../format";
import type { ReportEvidence, RunSummary, Tone } from "../report.types";
import { bySeverityDescending, computeSeverityPrior } from "./severity";

/**
 * The reading someone gets before they decide whether to read the rest.
 *
 * The eleven questions are written for whoever owns the agent. The people who
 * are told about the run — a product manager, whoever signs off a release —
 * need the same run to answer something shorter: is this all right, did it move,
 * what did it cost, and what is the one thing to fix. They should not have to
 * infer that from a pass rate or scroll through failure groups to find it.
 *
 * Entirely computed, so this renders at every tier, including when no model ran.
 * Nothing here names a run id: an identifier is not an answer to any of those
 * questions.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

/** Below this, a change in pass rate is noise rather than movement. */
const MEANINGFUL_MOVE_POINTS = 5;

/**
 * The share of a run that can go unjudged before the run stops describing the
 * agent at all. Set low because the failure it guards against is silent: a run
 * where most scenarios errored still produces a pass rate, and that rate reads
 * as a verdict on the agent when it is really a verdict on the harness.
 */
const UNJUDGED_SHARE_THAT_MISLEADS = 0.25;

function unjudgedCount(evidence: ReportEvidence): number {
  return evidence.signatures
    .filter((signature) => signature.kind !== "judged")
    .reduce((total, signature) => total + signature.runIds.length, 0);
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * What moved since the run before, in points of pass rate.
 *
 * Compared against the immediately preceding run rather than an average: the
 * question a reader is asking is "did what we just did make it worse", and an
 * average over ten runs hides exactly that.
 */
function movementSentence(evidence: ReportEvidence): string | null {
  const previous = [...evidence.priorBatches]
    .sort((a, b) => a.startedAt - b.startedAt)
    .filter((batch) => batch.passRate !== null)
    .at(-1);
  const current = evidence.passRate.value;
  if (previous?.passRate == null || current === null) return null;

  const delta = current - previous.passRate;
  if (Math.abs(delta) < MEANINGFUL_MOVE_POINTS) {
    return "About the same as the run before it.";
  }
  const direction = delta > 0 ? "up" : "down";
  return `That is ${direction} ${Math.abs(delta).toFixed(0)} points on the run before it.`;
}

/**
 * The failure worth naming first, in the words the run itself used.
 *
 * Ranked by the same severity the report's own "which failure matters most"
 * section ranks by — NOT by how many scenarios it touched. Blast radius is a
 * poor proxy for consequence: six scenarios failing a tone criterion outrank a
 * single leak of another customer's data by count, and the reader this card is
 * written for is the one least likely to scroll down and find that out. Two
 * places naming a different "first thing to fix" is worse than either alone.
 *
 * Ties break on reach, so among equals the widest is named.
 */
function topProblem(evidence: ReportEvidence): string | null {
  const trendByCriterion = new Map(
    evidence.trend.map((fact) => [fact.criterionId, fact.classification]),
  );
  const worst = [...evidence.signatures]
    .map((signature) => ({
      signature,
      severity: computeSeverityPrior({
        signature,
        trendByCriterion,
        settledRuns: evidence.counts.settledCount,
      }),
    }))
    .sort(
      (a, b) =>
        bySeverityDescending(a.severity, b.severity) ||
        b.signature.runIds.length - a.signature.runIds.length,
    )[0];
  if (!worst) return null;

  const criterionId = worst.signature.unmetCriterionIds[0];
  const criterion = evidence.criteria.find(
    (fact) => fact.criterionId === criterionId,
  );
  const affected = plural(
    worst.signature.runIds.length,
    "scenario",
    "scenarios",
  );

  // A run that errored has no criterion to be named by — it never got as far
  // as being judged against one.
  if (criterionId === undefined || !criterion) {
    return `The most serious failure stopped ${affected} before a verdict.`;
  }
  return trendByCriterion.get(criterionId) === "regression"
    ? `Something that used to hold has broken: "${criterion.text}", in ${affected}.`
    : `The most serious failure is "${criterion.text}", in ${affected}.`;
}

/**
 * Why the headline figure might not mean what it appears to.
 *
 * A run that mostly errored still produces a pass rate, and that rate looks
 * exactly like a verdict on the agent. Saying so here is the difference between
 * a reader concluding "the agent is broken" and "the test run is broken".
 */
function caveat(evidence: ReportEvidence): string | null {
  const unjudged = unjudgedCount(evidence);
  const total = evidence.counts.totalCount;
  if (total > 0 && unjudged / total >= UNJUDGED_SHARE_THAT_MISLEADS) {
    return `${unjudged} of ${total} scenarios never reached a verdict, so this says less about the agent than the numbers suggest — those are failures of the run, not of the agent.`;
  }
  if (evidence.isStillRunning) {
    return "Some scenarios had not finished, so these figures cover only the ones that had.";
  }
  if (evidence.passRate.inconclusiveReason === "too_few_runs") {
    return "Too few scenarios settled to read a percentage into.";
  }
  if (evidence.passRate.inconclusiveReason === "spread_too_wide") {
    return "Results varied enough across scenarios that the rate does not pin down how the agent behaves.";
  }
  return null;
}

function verdict(evidence: ReportEvidence): { text: string; tone: Tone } {
  const { counts } = evidence;
  if (counts.settledCount === 0) {
    return {
      text: "Nothing has finished yet, so there is nothing to judge.",
      tone: "muted",
    };
  }
  if (unjudgedCount(evidence) / Math.max(1, counts.totalCount) >= 0.5) {
    return {
      text: "Most of this run never got far enough to judge the agent.",
      tone: "warn",
    };
  }
  // `failedCount` is only ERROR and FAILED. A stalled or cancelled run did
  // not pass either, and telling someone everything passed when three
  // scenarios never finished is the single most misleading sentence this
  // report could open with.
  if (counts.passedCount === counts.settledCount && counts.settledCount > 0) {
    return {
      text: `Everything passed — ${plural(counts.passedCount, "scenario", "scenarios")}, no failures.`,
      tone: "pass",
    };
  }
  if (evidence.trend.some((fact) => fact.classification === "regression")) {
    return {
      text: "Something that was working has stopped working.",
      tone: "fail",
    };
  }
  return {
    text: `${plural(counts.failedCount, "scenario", "scenarios")} failed out of ${counts.settledCount}.`,
    tone: counts.failedCount > counts.passedCount ? "fail" : "warn",
  };
}

export function buildRunSummary({
  evidence,
}: {
  evidence: ReportEvidence;
}): RunSummary {
  const { text, tone } = verdict(evidence);
  const cost = formatCost(evidence.batch.totalCost);

  return {
    verdict: text,
    tone,
    movement: movementSentence(evidence),
    facts: [
      {
        label: "Scenarios",
        value: String(evidence.counts.totalCount),
      },
      { label: "Took", value: formatDuration(evidence.batch.durationMs) },
      ...(cost === null ? [] : [{ label: "Cost", value: cost }]),
    ],
    topProblem: topProblem(evidence),
    caveat: caveat(evidence),
  };
}
