/**
 * Whether a win matrix actually carries head-to-head information.
 *
 * The grid is drawn as "row beat column, tinted by win rate", which invites
 * the reading "warm beats formal specifically". That reading is only earned
 * when different verdicts pitted different subsets of variants against each
 * other.
 *
 * A Comparison evaluator judges the WHOLE field in one verdict, so a single
 * win makes the winner beat every other variant at once. When every verdict
 * covers every variant, each winner's row is the same number repeated — that
 * variant's total wins, carrying no per-opponent signal. Observed on a real
 * four-way run: rows of 28|28|28, 20|20|20, 8|8|8, 4|4|4, from 60 verdicts
 * that all had exactly four candidates.
 *
 * The CELLS are not equally empty, and the caveat must not say they are: each
 * is tinted by w/(w+l) for that pair, which does vary — 28 wins against 20
 * losses reads very differently from 28 against 4. So the caveat points the
 * reader at the shading rather than dismissing the grid.
 *
 * Detecting it from the matrix itself, rather than from the candidate lists,
 * keeps this honest for the mixed case too: a run whose verdicts happened to
 * cover the full field every time is indistinguishable from one designed that
 * way, and both deserve the same caveat.
 */

import type { WinMatrix } from "./batch-evaluation-results.bt-leaderboard";

/**
 * True when at least one variant's row varies across opponents — i.e. the run
 * separated some pair differently from another, so the grid is worth reading
 * cell by cell.
 *
 * Variants with no wins at all are skipped rather than counted as uniform:
 * an all-zero row is the absence of evidence, not evidence of uniformity, and
 * letting it vote would call a genuinely informative matrix flat.
 */
export const winMatrixHasPairwiseDetail = ({
  winMatrix,
  variantIds,
}: {
  winMatrix: WinMatrix;
  variantIds: string[];
}): boolean => {
  for (const rowId of variantIds) {
    const row = winMatrix[rowId];
    if (!row) continue;

    const values = variantIds.filter((colId) => colId !== rowId).map((colId) => row[colId] ?? 0);

    if (values.length < 2) continue;
    if (values.every((value) => value === 0)) continue;

    const [first] = values;
    if (values.some((value) => value !== first)) return true;
  }

  return false;
};
