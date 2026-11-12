import type { ExperimentRunResultsResponse } from "@/client-sdk/services/experiments/experiments-api.service";

/** How often one dataset row passed against one target, over the run's repetitions of it. */
export interface RowPassRate {
  /** The dataset row, counted from 1. */
  row: number;
  targetId: string | null;
  targetName: string | null;
  passed: number;
  /** Repetitions that reached a pass or fail verdict, errors included. */
  graded: number;
  repeat: number;
}

/** A repetition's verdict: an error or a failed verdict fails it; no verdict leaves it out. */
function repetitionVerdict({
  errored,
  verdicts,
}: {
  errored: boolean;
  verdicts: (boolean | null | undefined)[];
}): boolean | null {
  if (errored) return false;
  const graded = verdicts.filter((verdict): verdict is boolean => typeof verdict === "boolean");
  if (graded.length === 0) return null;
  return graded.every(Boolean);
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

function count({ rate, verdict }: { rate: RowPassRate; verdict: boolean | null }): void {
  if (verdict === null) return;
  rate.graded += 1;
  if (verdict) rate.passed += 1;
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
  const verdicts = new Map<string, (boolean | null | undefined)[]>();
  for (const evaluation of results.evaluations) {
    if (evaluation.status === "skipped") continue;
    const key = keyOf(evaluation.index, evaluation.targetId);
    const verdict = evaluation.status === "error" ? false : evaluation.passed;
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

/** "2/3 passed (67%)", or "no pass or fail verdict" for a row nothing graded. */
export function passRateText(rate: RowPassRate): string {
  if (rate.graded === 0) return "no pass or fail verdict";
  const percent = Math.round((rate.passed / rate.graded) * 100);
  return `${rate.passed}/${rate.graded} passed (${percent}%)`;
}
