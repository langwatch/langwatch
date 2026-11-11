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
  passRate: number;
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

/** Passed over passed plus failed, as a percentage; the board's own pass rate. */
function passRateOf({ passed, failed }: { passed: number; failed: number }): number | undefined {
  return passed + failed > 0 ? (passed / (passed + failed)) * 100 : undefined;
}

/**
 * Rolls each cell's evaluator verdicts up into per-evaluator tallies a CI job can gate
 * on. Only explicit verdicts count: a score with no `passed` adds to the average, not
 * to either count. Comparison evaluators keep no verdicts, so they never appear.
 * A run with no evaluators answers none, so the summary keeps its cell counts only.
 */
export function summariseEvaluatorVerdicts({
  evaluators,
  evaluatorScores,
}: {
  evaluators: Record<string, ExperimentRunFoldEvaluator>;
  evaluatorScores: Record<string, Record<string, ExperimentRunEvaluatorScore>>;
}): ExperimentRunVerdictSummary | undefined {
  const tallied = Object.entries(evaluators).filter(([, evaluator]) => !evaluator.comparison);
  if (tallied.length === 0) return undefined;

  const cells = Object.values(evaluatorScores);
  const tallies = tallied.map(([evaluatorId, evaluator]) => {
    const verdicts = cells.flatMap((byEvaluator) => {
      const verdict = byEvaluator[evaluatorId];
      return verdict ? [verdict] : [];
    });
    const passed = verdicts.filter((verdict) => verdict.passed === true).length;
    const failed = verdicts.filter((verdict) => verdict.passed === false).length;
    const scores = verdicts.flatMap((verdict) => (verdict.score != null ? [verdict.score] : []));
    return {
      evaluatorId,
      name: verdicts[0]?.name ?? evaluator.fallbackName,
      passed,
      failed,
      passRate: passRateOf({ passed, failed }) ?? 0,
      ...(scores.length > 0
        ? { avgScore: scores.reduce((sum, score) => sum + score, 0) / scores.length }
        : {}),
    };
  });

  return { evaluators: tallies };
}
