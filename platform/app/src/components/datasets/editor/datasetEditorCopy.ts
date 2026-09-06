/**
 * User-facing copy for the dataset editor, kept as pure builders so the strings
 * are pinned by tests and can't silently drift (copywriting.md: copy hidden
 * behind a `(?)` tooltip is pinned to the code by a test).
 */

/**
 * Fixed `en-US` separator (1,640) for record counts. Pinned rather than
 * `toLocaleString()` (runtime locale) so the copy is deterministic — the tooltip
 * text and visible count stay identical across browsers/CI, and the pinned-copy
 * test doesn't break under a non-en locale (`1.640` / `1 640`).
 */
const recordCountFormatter = new Intl.NumberFormat("en-US");

/** Format a record count with the editor's fixed thousands separator. */
export const formatRecordCount = (count: number): string =>
  recordCountFormatter.format(count);

/**
 * Tooltip shown on the truncated-read count chip. A large dataset is loaded into
 * the editor up to a byte budget, so only the first rows are shown; this
 * explains that nothing is lost, that editing a visible row is safe, and how to
 * get the complete data.
 */
export const truncatedReadTooltip = ({
  shown,
  total,
}: {
  shown: number;
  total: number;
}): string =>
  `This dataset is too large to display in full here — showing ${formatRecordCount(shown)} out of ${formatRecordCount(total)} rows. Editing a visible row saves just that row; use Download as CSV for the complete dataset.`;
