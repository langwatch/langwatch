/**
 * What the evaluator results of a run say, read three ways: one result on one
 * scenario run, the evaluator that failed a run, and one evaluator over every
 * scenario of a run.
 *
 * A pass or fail evaluator on one run reads Pass or Fail; over a run it reads
 * a pass rate. A score evaluator reads its number on one run and the mean
 * over a run. A run on which an evaluator had nothing to read is skipped, and
 * a skipped result counts in no rate and no mean.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 */

import type { ScenarioEvaluationResult } from "~/server/scenarios/schemas/event-schemas";

export type RunEvaluation = ScenarioEvaluationResult;

/** What an evaluator measures: a verdict, or a number. */
export type EvaluatorKind = "passfail" | "score";

/** The shape every row of a results table carries its evaluations in. */
export type RunWithEvaluations = {
  results?: { evaluations?: RunEvaluation[] | null } | null;
};

export function evaluationsOf(run: RunWithEvaluations): RunEvaluation[] {
  return run.results?.evaluations ?? [];
}

/**
 * What one result measures, or null when it measured nothing: a skipped
 * result and an error carry neither a verdict nor a number.
 */
export function evaluationKind(
  evaluation: RunEvaluation,
): EvaluatorKind | null {
  if (
    evaluation.status === "passed" ||
    evaluation.status === "failed" ||
    evaluation.passed !== undefined
  ) {
    return "passfail";
  }
  if (evaluation.status === "scored" || evaluation.score !== undefined) {
    return "score";
  }
  return null;
}

/** True when a result fails the run it belongs to. */
export function failsRun(evaluation: RunEvaluation): boolean {
  return (
    evaluation.required &&
    (evaluation.status === "failed" || evaluation.status === "error")
  );
}

/**
 * The name of the required evaluator that failed the run, or null when none
 * did. The first one in the order the evaluators ran, when several failed.
 */
export function failedRequiredEvaluatorName(
  evaluations: readonly RunEvaluation[],
): string | null {
  const failed = evaluations.find(failsRun);
  return failed ? failed.name : null;
}

/** One evaluator over every scenario run of a run. */
export interface EvaluatorSummary {
  evaluatorId: string;
  name: string;
  /** Null when the evaluator measured nothing on any scenario of the run. */
  kind: EvaluatorKind | null;
  /** 0 to 100 over the scenarios it passed or failed; null for a score. */
  passRate: number | null;
  /** The mean of its scores; null for a pass or fail evaluator. */
  meanScore: number | null;
  /** How many scenario runs gave it something to read. */
  counted: number;
  /** How many scenario runs gave it no verdict and no number: skipped, or an error. */
  skipped: number;
}

/** The running count of one evaluator across the runs read so far. */
interface EvaluatorTally {
  name: string;
  passed: number;
  failed: number;
  scores: number[];
  skipped: number;
}

function tallyEvaluation({
  tally,
  evaluation,
}: {
  tally: EvaluatorTally;
  evaluation: RunEvaluation;
}): void {
  tally.name = evaluation.name;
  const kind = evaluationKind(evaluation);
  if (kind === "passfail") {
    const passed = evaluation.passed ?? evaluation.status === "passed";
    if (passed) tally.passed += 1;
    else tally.failed += 1;
  } else if (kind === "score" && evaluation.score !== undefined) {
    tally.scores.push(evaluation.score);
  } else {
    tally.skipped += 1;
  }
}

function summaryOfTally({
  evaluatorId,
  tally,
}: {
  evaluatorId: string;
  tally: EvaluatorTally;
}): EvaluatorSummary {
  const verdicts = tally.passed + tally.failed;
  const kind: EvaluatorKind | null =
    verdicts > 0 ? "passfail" : tally.scores.length > 0 ? "score" : null;
  const scoreSum = tally.scores.reduce((sum, score) => sum + score, 0);
  return {
    evaluatorId,
    name: tally.name,
    kind,
    passRate: verdicts > 0 ? (tally.passed / verdicts) * 100 : null,
    meanScore: kind === "score" ? scoreSum / tally.scores.length : null,
    counted: verdicts + tally.scores.length,
    skipped: tally.skipped,
  };
}

/**
 * One summary per evaluator, in the order the evaluators first appear across
 * the runs. The name is the one the most recent result carries, so a renamed
 * evaluator reads by its current name.
 */
export function summarizeEvaluations({
  runs,
}: {
  runs: readonly RunWithEvaluations[];
}): EvaluatorSummary[] {
  const tallies = new Map<string, EvaluatorTally>();

  for (const run of runs) {
    for (const evaluation of evaluationsOf(run)) {
      const tally = tallies.get(evaluation.evaluatorId) ?? {
        name: evaluation.name,
        passed: 0,
        failed: 0,
        scores: [],
        skipped: 0,
      };
      tallyEvaluation({ tally, evaluation });
      tallies.set(evaluation.evaluatorId, tally);
    }
  }

  return [...tallies.entries()].map(([evaluatorId, tally]) =>
    summaryOfTally({ evaluatorId, tally }),
  );
}
