/**
 * Where a run over a dataset version meets the workbench board: rows match by id, since a
 * version keeps the ids its rows had. Spec: specs/experiments-v3/dataset-version-pin.feature.
 */

/** The board row of each run row, by id; null for a run row the board no longer has. */
export const boardRowIndicesOf = ({
  runRowIds,
  boardRowIds,
}: {
  runRowIds: readonly string[];
  boardRowIds: readonly string[];
}): (number | null)[] => {
  const boardIndexById = new Map(boardRowIds.map((id, index) => [id, index]));
  return runRowIds.map((id) => boardIndexById.get(id) ?? null);
};
