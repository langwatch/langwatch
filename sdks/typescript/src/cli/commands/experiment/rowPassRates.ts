import type { ExperimentRunResultsResponse } from "@/client-sdk/services/experiments/experiments-api.service";

/** How often one dataset row passed against one target, over the run's repetitions of it. */
export interface RowPassRate {
  /** The dataset row, counted from 1. */
  row: number;
  targetId: string | null;
  targetName: string | null;
  passed: number;
  /** Repetitions that reached a pass or fail verdict. */
  graded: number;
  /** Repetitions whose target or evaluator errored, left out of `graded` as the run Score is. */
  errors: number;
  repeat: number;
}

type Verdict = boolean | "error" | null | undefined;

/** A repetition's verdict: a fail fails it, else an error marks it errored; no verdict is null. */
function repetitionVerdict({
  errored,
  verdicts,
}: {
  errored: boolean;
  verdicts: Verdict[];
}): "passed" | "failed" | "errored" | null {
  if (errored) return "errored";
  if (verdicts.includes(false)) return "failed";
  if (verdicts.includes("error")) return "errored";
  return verdicts.includes(true) ? "passed" : null;
}

const keyOf = (index: number, targetId: string | null | undefined) => `${index}:${targetId ?? ""}`;

/** Every run row and target the results hold, from its rows or its evaluations. */
function cellsOf(
  results: Pick<ExperimentRunResultsResponse, "dataset" | "evaluations">,
): Map<string, { index: number; targetId: string | null }> {
  const cells = new Map<string, { index: number; targetId: string | null }>();
  for (const item of [...results.dataset, ...results.evaluations]) {
    const key = keyOf(item.index, item.targetId);
    if (!cells.has(key)) cells.set(key, { index: item.index, targetId: item.targetId ?? null });
  }
  return cells;
}

function count({
  rate,
  verdict,
}: {
  rate: RowPassRate;
  verdict: ReturnType<typeof repetitionVerdict>;
}): void {
  if (verdict === "errored") rate.errors += 1;
  if (verdict === "passed" || verdict === "failed") rate.graded += 1;
  if (verdict === "passed") rate.passed += 1;
}

/**
 * The pass rate of every dataset row and target of a repeated run. Run row `r * repeat + k`
 * is repetition `k` of dataset row `r`.
 * @see specs/experiments-v3/run-repeat.feature
 */
export function rowPassRatesOf({
  results,
  repeat,
}: {
  results: Pick<ExperimentRunResultsResponse, "dataset" | "evaluations"> & {
    targets?: { id: string; name: string }[] | null;
  };
  repeat: number;
}): RowPassRate[] {
  const names = new Map((results.targets ?? []).map((target) => [target.id, target.name]));
  const errored = new Set(
    results.dataset.filter((entry) => !!entry.error).map((e) => keyOf(e.index, e.targetId)),
  );
  const verdicts = new Map<string, Verdict[]>();
  for (const evaluation of results.evaluations) {
    if (evaluation.status === "skipped") continue;
    const key = keyOf(evaluation.index, evaluation.targetId);
    const verdict = evaluation.status === "error" ? "error" : evaluation.passed;
    verdicts.set(key, [...(verdicts.get(key) ?? []), verdict]);
  }

  const rates = new Map<string, RowPassRate>();
  for (const [key, cell] of cellsOf(results)) {
    const row = Math.floor(cell.index / repeat);
    const rateKey = keyOf(row, cell.targetId);
    const rate = rates.get(rateKey) ?? {
      row: row + 1,
      targetId: cell.targetId,
      targetName: cell.targetId ? (names.get(cell.targetId) ?? null) : null,
      passed: 0,
      graded: 0,
      errors: 0,
      repeat,
    };
    count({
      rate,
      verdict: repetitionVerdict({
        errored: errored.has(key),
        verdicts: verdicts.get(key) ?? [],
      }),
    });
    rates.set(rateKey, rate);
  }

  return [...rates.values()].toSorted(
    (a, b) => a.row - b.row || (a.targetName ?? "").localeCompare(b.targetName ?? ""),
  );
}

/** "2/3 passed (67%)", "2/2 passed (100%), 1 error", or "no pass or fail verdict". */
export function passRateText(rate: RowPassRate): string {
  const errors = rate.errors > 0 ? `${rate.errors} ${rate.errors === 1 ? "error" : "errors"}` : "";
  if (rate.graded === 0)
    return errors ? `no pass or fail verdict, ${errors}` : "no pass or fail verdict";
  const percent = Math.round((rate.passed / rate.graded) * 100);
  const passRate = `${rate.passed}/${rate.graded} passed (${percent}%)`;
  return errors ? `${passRate}, ${errors}` : passRate;
}
