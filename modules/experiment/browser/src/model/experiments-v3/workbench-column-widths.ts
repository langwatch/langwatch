/** How wide each workbench column is: stored percentages, per-kind defaults and minimums. */

export const CHECKBOX_WIDTH_PX = 40;
export const DATASET_COL_DEFAULT_PCT = 16;
export const TARGET_COL_DEFAULT_PCT = 20;
/**
 * A comparison column carries strictly more header content than a prompt/agent column —
 * its name, the "<winner> wins" verdict, latency, cost AND the run button share one row.
 */
export const COMPARISON_COL_DEFAULT_PCT = 24;
export const COMPARISON_COL_MIN_PCT = 14;

/** Whether a column shows a comparison: its own result column, or a comparison target's. */
const isComparisonColumn = ({
  columnId,
  columnType,
  comparisonTargetIds,
}: {
  columnId: string;
  columnType: string;
  comparisonTargetIds: Set<string>;
}): boolean =>
  columnType === "comparison" ||
  (columnType === "target" && comparisonTargetIds.has(columnId.replace(/^target\./, "")));

/** A column's default width, by id and kind — the one place every sizing path reads it from. */
export const defaultPctForColumn = (column: {
  columnId: string;
  columnType: string;
  comparisonTargetIds: Set<string>;
}): number => {
  if (column.columnType === "dataset") return DATASET_COL_DEFAULT_PCT;
  return isComparisonColumn(column) ? COMPARISON_COL_DEFAULT_PCT : TARGET_COL_DEFAULT_PCT;
};

/** A column's own minimum width, so a resize never squeezes it below what it shows. */
export const minPctForColumn = (column: {
  columnId: string;
  columnType: string;
  comparisonTargetIds: Set<string>;
}): number => {
  if (column.columnType === "dataset") return 8;
  return isComparisonColumn(column) ? COMPARISON_COL_MIN_PCT : 10;
};

/**
 * The table's total width in percent, summed over the dataset, target and comparison
 * columns (ids as the headers write them), so the table may grow past 100%.
 */
export const totalColumnPct = ({
  columnSizing,
  datasetColumnIds,
  targetIds,
  comparisonEvaluatorIds,
  comparisonTargetIds,
}: {
  columnSizing: Record<string, number>;
  datasetColumnIds: string[];
  targetIds: string[];
  comparisonEvaluatorIds: string[];
  comparisonTargetIds: Set<string>;
}): number => {
  const widthOf = (columnId: string, columnType: string) =>
    columnSizing[columnId] ?? defaultPctForColumn({ columnId, columnType, comparisonTargetIds });
  return (
    datasetColumnIds.reduce((sum, id) => sum + widthOf(`dataset.${id}`, "dataset"), 0) +
    targetIds.reduce((sum, id) => sum + widthOf(`target.${id}`, "target"), 0) +
    comparisonEvaluatorIds.reduce((sum, id) => sum + widthOf(`comparison.${id}`, "comparison"), 0)
  );
};

/** A column's CSS width: fixed pixels for the checkbox, else its stored or default percent. */
export const columnWidthCss = ({
  columnId,
  columnType,
  isFixedWidth,
  columnSizing,
  comparisonTargetIds,
}: {
  columnId: string;
  columnType: string;
  isFixedWidth?: boolean;
  columnSizing: Record<string, number>;
  comparisonTargetIds: Set<string>;
}): string => {
  if (columnId === "select" || isFixedWidth) return `${CHECKBOX_WIDTH_PX}px`;
  const storedPct = columnSizing[columnId];
  if (storedPct) return `${storedPct}%`;
  if (columnType === "dataset" || columnType === "target" || columnType === "comparison") {
    return `${defaultPctForColumn({ columnId, columnType, comparisonTargetIds })}%`;
  }
  return "auto";
};
