/**
 * How wide the columns of a comparison table are.
 * @see specs/features/agent-testing/comparison-mode.feature
 */

/** The width of the first column, the one that names the scenario. */
export const SCENARIO_COLUMN_WIDTH = 200;
/** The width a target column takes when its label is a short one. */
export const TARGET_COLUMN_MIN_WIDTH = 220;
/** How wide one target column can grow before its label wraps instead. */
export const TARGET_COLUMN_MAX_WIDTH = 380;
/** About the width of one character of the header label, in pixels. */
const LABEL_CHARACTER_WIDTH = 6.8;
/** The dot, the gap and the padding that sit beside the label. */
const LABEL_CHROME_WIDTH = 26;

/** The width every target column of the table takes. */
export function targetColumnWidth(targets: readonly { label: string }[]): number {
  const longest = targets.reduce((width, target) => Math.max(width, target.label.length), 0);
  const needed = Math.ceil(longest * LABEL_CHARACTER_WIDTH) + LABEL_CHROME_WIDTH;
  return Math.min(Math.max(TARGET_COLUMN_MIN_WIDTH, needed), TARGET_COLUMN_MAX_WIDTH);
}

/** The scenario column's share of the width, against one share per target column. */
const SCENARIO_SHARE = 1.2;
/** The padding a table cell holds beside its content, both sides together. */
const CELL_PADDING = 28;

/**
 * How the table lays its columns out: each column a share of the width (the scenario 1.2,
 * each target 1), and the width under which it scrolls rather than squeezing a column
 * below its smallest width.
 */
export function comparisonColumns(targets: readonly { label: string }[]): {
  scenarioWidth: `${number}%`;
  targetWidth: `${number}%`;
  minWidth: `${number}px`;
} {
  const width = targetColumnWidth(targets);
  const shares = SCENARIO_SHARE + targets.length;
  const perShare = Math.max(
    (SCENARIO_COLUMN_WIDTH + CELL_PADDING) / SCENARIO_SHARE,
    width + CELL_PADDING,
  );
  return {
    scenarioWidth: `${Number(((SCENARIO_SHARE / shares) * 100).toFixed(3))}%`,
    targetWidth: `${Number(((1 / shares) * 100).toFixed(3))}%`,
    minWidth: `${Math.ceil(perShare * shares)}px`,
  };
}
