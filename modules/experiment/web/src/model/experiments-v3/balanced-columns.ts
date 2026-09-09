/**
 * Pick a column count for the comparison variant grid so the rows come out even. A
 * `Wrap` reflows ragged — twelve variants land as 4/4/3/1, and the lone trailing card
 * reads as a mistake rather than a layout.
 */
const CANDIDATE_COLUMNS: number[] = [4, 3];

export const balancedColumns = (variantCount: number): number => {
  if (variantCount <= 1) return 1;
  if (variantCount < 5) return variantCount;

  for (const columns of CANDIDATE_COLUMNS) {
    if (variantCount % columns === 0) return columns;
  }

  // No exact fit. Maximise the last row's size; `>` on the comparison keeps
  // the first (larger) column count when the two tie.
  let best = CANDIDATE_COLUMNS[0]!;
  let fullestLastRow = 0;
  for (const columns of CANDIDATE_COLUMNS) {
    const lastRow = variantCount % columns;
    if (lastRow > fullestLastRow) {
      fullestLastRow = lastRow;
      best = columns;
    }
  }
  return best;
};
