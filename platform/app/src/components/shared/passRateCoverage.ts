/**
 * How much of a dataset a rate actually covers.
 *
 * A pass rate is worked out over the rows that produced a verdict, so a column
 * that has finished 30 of 40 rows reports a rate for those 30. On its own that
 * figure reads as the column's score. Two columns at different points in a run
 * then look comparable when they describe different parts of the dataset, and a
 * reader acts on the comparison rather than on the arithmetic.
 *
 * Both the workbench header and the results page ask this, so the wording a
 * reader sees is the same on either surface.
 */
export type PassRateCoverage = {
  /** True when the rate covers every row the dataset holds. */
  isComplete: boolean;
  completedRows: number;
  totalRows: number;
  /** "30 of 40 rows", for placing next to a rate that covers part of a dataset. */
  label: string;
};

export const passRateCoverage = ({
  completedRows,
  totalRows,
}: {
  completedRows: number;
  totalRows: number;
}): PassRateCoverage => ({
  // A dataset with no rows is not a partial dataset, so it never reads as one.
  isComplete: totalRows === 0 || completedRows >= totalRows,
  completedRows,
  totalRows,
  label: `${completedRows} of ${totalRows} ${totalRows === 1 ? "row" : "rows"}`,
});
