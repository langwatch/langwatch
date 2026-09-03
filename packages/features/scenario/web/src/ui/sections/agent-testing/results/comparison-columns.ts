/**
 * How wide the columns of a comparison table are.
 *
 * The header of a target column carries the whole label of the target, which
 * is the agent name with its environment and the parameters that tell two
 * targets of the same agent apart. The width is read off the longest of them,
 * so a long name keeps a column of its own instead of running over the column
 * beside it. Past the maximum the label wraps to a second line and the
 * columns stay where they are.
 *
 * The header and the rows are separate grids, so both are given the same
 * template and the columns stay aligned.
 *
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

/** The grid template the header and every row of the table are drawn on. */
export function comparisonColumns(targets: readonly { label: string }[]): {
  template: string;
  minWidth: string;
} {
  const width = targetColumnWidth(targets);
  return {
    template: `minmax(${SCENARIO_COLUMN_WIDTH}px, 1.2fr) repeat(${targets.length}, minmax(${width}px, 1fr))`,
    minWidth: `${SCENARIO_COLUMN_WIDTH + targets.length * width}px`,
  };
}
