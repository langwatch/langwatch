import type {
  ExperimentRunEvaluatorScore,
  ExperimentRunFoldEvaluator,
} from "../repositories/experiment-run-fold.repository.ts";

/** One evaluator's tally across the run, as the poll summary carries it. */
export type ExperimentRunEvaluatorTally = {
  evaluatorId: string;
  name: string;
  passed: number;
  failed: number;
  /** Cells where the evaluator crashed and gave no verdict; a gate counts them as failures. */
  errored: number;
  /** Share of verdicts that passed, in percent; absent when the evaluator gave none. */
  passRate?: number;
  avgScore?: number;
};

/**
 * What a completed run's summary adds to its cell counts. `totalPassed`, `totalFailed`
 * and `passRate` stay unset on purpose: released SDKs read `totalFailed ?? failedCells`
 * as their default exit gate, so filling it would turn their green CI red.
 */
export type ExperimentRunVerdictSummary = {
  evaluators: ExperimentRunEvaluatorTally[];
};

/**
 * Rolls cell verdicts into per-evaluator tallies a CI job can gate on. A score with no
 * `passed` only feeds the average; a crashed evaluator counts as errored, never passed.
 * Comparison evaluators are left out. The list is always present, empty or not.
 */
export function summariseEvaluatorVerdicts({
  evaluators,
  evaluatorScores,
}: {
  evaluators: Record<string, ExperimentRunFoldEvaluator>;
  evaluatorScores: Record<string, Record<string, ExperimentRunEvaluatorScore>>;
}): ExperimentRunVerdictSummary {
  const tallied = Object.entries(evaluators).filter(([, evaluator]) => !evaluator.comparison);
  const cells = Object.values(evaluatorScores);
  const tallies = tallied.map(([evaluatorId, evaluator]) => {
    const verdicts = cells.flatMap((byEvaluator) => {
      const verdict = byEvaluator[evaluatorId];
      return verdict ? [verdict] : [];
    });
    const passed = verdicts.filter((verdict) => verdict.passed === true).length;
    const failed = verdicts.filter((verdict) => verdict.passed === false).length;
    const errored = verdicts.filter((verdict) => verdict.errored === true).length;
    const scores = verdicts.flatMap((verdict) => (verdict.score != null ? [verdict.score] : []));
    return {
      evaluatorId,
      name: verdicts[0]?.name ?? evaluator.fallbackName,
      passed,
      failed,
      errored,
      ...(passed + failed > 0 ? { passRate: (passed / (passed + failed)) * 100 } : {}),
      ...(scores.length > 0
        ? { avgScore: scores.reduce((sum, score) => sum + score, 0) / scores.length }
        : {}),
    };
  });

  return { evaluators: tallies };
}
