/**
 * How much of a dataset a rate actually covers.
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
