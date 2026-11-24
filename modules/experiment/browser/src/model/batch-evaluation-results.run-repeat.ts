/**
 * A repeated run: run row `r * repeat + k` is repetition `k` of dataset row `r`, so the page
 * groups the run's rows by dataset row and counts how often each passed per target.
 * @see specs/experiments-v3/run-repeat.feature
 */

/** What a run's repeat badge means, for its tooltip. */
export function runRepeatExplanation(repeat: number): string {
  return `Ran every dataset row ${repeat} times against every target.`;
}

/** Where a run row sits in a repeated run: its dataset row and repetition, both from 0. */
export function repetitionOf({ index, repeat }: { index: number; repeat: number }): {
  datasetRow: number;
  repetition: number;
} {
  return { datasetRow: Math.floor(index / repeat), repetition: index % repeat };
}

/** "1 · 2/3": the dataset row, counted from 1, and which of its repetitions this row is. */
export function repetitionLabel({ index, repeat }: { index: number; repeat: number }): string {
  const { datasetRow, repetition } = repetitionOf({ index, repeat });
  return `${datasetRow + 1} · ${repetition + 1}/${repeat}`;
}

/**
 * How often one dataset row passed against one target, over its repetitions. An errored
 * repetition is counted apart and left out of `graded`, as the run's Score leaves it out.
 */
export type RowPassRate = { passed: number; graded: number; errors: number };

/** One run row's outcome against one target, as the table holds it. */
type RepetitionOutcome = {
  error: string | null;
  domainError?: unknown;
  evaluatorResults: { status: string; passed?: boolean | null }[];
};

/** A repetition's verdict: a fail fails it, else an error marks it errored; no verdict is null. */
export function repetitionVerdict(
  outcome: RepetitionOutcome,
): "passed" | "failed" | "errored" | null {
  if (outcome.error || outcome.domainError) return "errored";
  const graded = outcome.evaluatorResults.filter((result) => result.status !== "skipped");
  if (graded.some((result) => result.status !== "error" && result.passed === false)) {
    return "failed";
  }
  if (graded.some((result) => result.status === "error")) return "errored";
  return graded.some((result) => result.passed === true) ? "passed" : null;
}

/** The pass rate of every dataset row and target, keyed `${datasetRow}:${targetId}`. */
export function rowPassRatesOf({
  rows,
  repeat,
}: {
  rows: { index: number; targets: Record<string, RepetitionOutcome> }[];
  repeat: number;
}): Map<string, RowPassRate> {
  const rates = new Map<string, RowPassRate>();
  for (const row of rows) {
    const { datasetRow } = repetitionOf({ index: row.index, repeat });
    for (const [targetId, outcome] of Object.entries(row.targets)) {
      const verdict = repetitionVerdict(outcome);
      const key = `${datasetRow}:${targetId}`;
      const rate = rates.get(key) ?? { passed: 0, graded: 0, errors: 0 };
      if (verdict === "errored") rate.errors += 1;
      if (verdict === "passed" || verdict === "failed") rate.graded += 1;
      if (verdict === "passed") rate.passed += 1;
      rates.set(key, rate);
    }
  }
  return rates;
}

/** "2/3", "2/2 · 1 error", or "-" for a row nothing graded or errored. */
export function passRateText(rate: RowPassRate | undefined): string {
  if (!rate) return "-";
  const errors = rate.errors > 0 ? `${rate.errors} ${rate.errors === 1 ? "error" : "errors"}` : "";
  if (rate.graded === 0) return errors || "-";
  const passRate = `${rate.passed}/${rate.graded}`;
  return errors ? `${passRate} · ${errors}` : passRate;
}
