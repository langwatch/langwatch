/**
 * Shared vocabulary for the question blocks.
 *
 * Applicability predicates, the trend's words, and the small formatters every
 * section reaches for. Kept apart from the blocks themselves so that adding a
 * question means writing one block builder rather than reading past four
 * hundred lines of unrelated ones.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

import type {
  Block,
  ReportEvidence,
  TrendClassification,
} from "../report.types";

/** Whether a question can be answered from this run, and why not when it cannot. */
export type Applicability =
  | { applicable: true }
  | { applicable: false; reason: string };

export const TREND_LABELS: Record<TrendClassification, string> = {
  regression: "broke since the last run",
  fixed: "fixed since the last run",
  long_standing: "has been failing for a while",
  unreliable: "keeps changing its mind",
  new: "not seen before",
  stable_pass: "holding",
  stable_fail: "still failing",
};

export function hasPriorRuns(evidence: ReportEvidence): Applicability {
  return evidence.priorBatches.length > 0
    ? { applicable: true }
    : {
        applicable: false,
        // Not "this is the first run": the report sees a bounded window of
        // history, so finding nothing earlier is a fact about what was read,
        // not about the suite. Claiming primacy would be asserting something
        // the evidence cannot support.
        reason:
          "No earlier run of this suite was available to compare against.",
      };
}

export function hasFailures(evidence: ReportEvidence): Applicability {
  return evidence.signatures.length > 0
    ? { applicable: true }
    : {
        applicable: false,
        reason: "Nothing failed in this run.",
      };
}

export function always(): Applicability {
  return { applicable: true };
}

export function trendClassificationById(
  evidence: ReportEvidence,
): Map<string, TrendClassification> {
  return new Map(
    evidence.trend.map((fact) => [fact.criterionId, fact.classification]),
  );
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function scenarioNameFor({
  evidence,
  scenarioId,
}: {
  evidence: ReportEvidence;
  scenarioId: string;
}): string {
  return (
    evidence.runs.find((run) => run.scenarioId === scenarioId)?.scenarioName ??
    scenarioId
  );
}

// ============================================================================
// Past
// ============================================================================

/**
 * Pass rate per run, oldest first, this run last.
 *
 * Runs whose rate is unknown are left out rather than drawn as zero — a run
 * that never settled is not a run that failed, and plotting it as one invents
 * a collapse. Ordered by when each run happened, so the line reads left to
 * right in the order they were seen.
 */
export function trendPoints(
  evidence: ReportEvidence,
): { label: string; value: number }[] {
  const earlier = [...evidence.priorBatches]
    .sort((a, b) => a.startedAt - b.startedAt)
    .filter((batch) => batch.passRate !== null)
    .map((batch) => ({
      label: batch.batchRunId,
      value: batch.passRate as number,
    }));

  return evidence.passRate.value === null
    ? earlier
    : [...earlier, { label: "This run", value: evidence.passRate.value }];
}
