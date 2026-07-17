/**
 * Pick a column count for the comparison variant grid so the rows come out
 * even. A `Wrap` reflows ragged — twelve variants land as 4/4/3/1, and the
 * lone trailing card reads as a mistake rather than a layout.
 *
 * Above four variants the grid is always three or four columns wide. Four
 * cards is the most that stays readable at drawer width, and two columns
 * turns a long list into a tall narrow strip (ten variants as 2/2/2/2/2
 * rather than 4/4/2).
 *
 * A column count that divides the variants exactly wins, since every row is
 * then full (12 -> 4/4/4, 9 -> 3/3/3). Otherwise we take the count whose
 * last row is fullest (7 -> 4/3, not 3/3/1), preferring four on a tie so the
 * grid stays wide rather than tall.
 *
 * A trailing row of one is unavoidable when the count is one more than a
 * multiple of both three and four (13, 25, ...). Nothing to do about that
 * short of an uneven grid, which is the thing we're removing.
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
