/**
 * Whether a win matrix actually carries head-to-head information.
 */

import type { WinMatrix } from "./batch-evaluation-results.bt-leaderboard";

/**
 * True when at least one variant's row varies across opponents — i.e. the run separated
 * some pair differently from another, so the grid is worth reading cell by cell.
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
