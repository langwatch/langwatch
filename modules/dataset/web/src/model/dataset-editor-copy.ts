/**
 * User-facing copy for the dataset editor, kept as pure builders so the strings
 * are pinned by tests and can't silently drift (copywriting.md: copy hidden
 * behind a `(?)` tooltip is pinned to the code by a test).
 */

/**
 * Fixed `en-US` separator (1,640), not `toLocaleString()` (runtime
 * locale), so the copy is deterministic across browsers/CI and the
 * pinned-copy test doesn't break under a non-en locale (`1.640` / `1 640`).
 */
const recordCountFormatter = new Intl.NumberFormat("en-US");

/** Format a record count with the editor's fixed thousands separator. */
export const formatRecordCount = (count: number): string => recordCountFormatter.format(count);

/** Show both match count and total so neither alone misleads. Omit total when
 * unsearched read hasn't settled.
 */
export const formatSearchRecordCount = ({
  matched,
  total,
}: {
  matched: number;
  total?: number;
}): string =>
  total === undefined
    ? `${formatRecordCount(matched)} matching ${
        matched === 1 ? "record" : "records"
      }`
    : `${formatRecordCount(matched)} of ${formatRecordCount(total)} records`;

/** The count chip with no search in effect: "679 records", "1 record". */
export const plainRecordCount = (count: number): string =>
  `${formatRecordCount(count)} ${count === 1 ? "record" : "records"}`;

/**
 * Shown in the grid when the server refused or failed the search. The toast
 * carries the reason and dismisses; this stays, so the screen never settles
 * into looking like a search that returned something.
 */
export const searchFailedMessage = (search: string): string =>
  `Couldn’t run the search for “${search}”.`;

/**
 * Shown in place of the grid when a search matched nothing, repeating the
 * searched text — with a debounce between typing and results, the user
 * needs to see which search this belongs to.
 */
export const noSearchMatchesMessage = (search: string): string =>
  `No records match “${search}”.`;

/**
 * Tooltip on the truncated-read count chip: a large dataset loads up to a
 * byte budget, so only the first rows show. Explains nothing is lost,
 * editing a visible row is safe, and how to get the complete data.
 */
export const truncatedReadTooltip = ({ shown, total }: { shown: number; total: number }): string =>
  `This dataset is too large to display in full here — showing ${formatRecordCount(shown)} out of ${formatRecordCount(total)} rows. Editing a visible row saves just that row; use Download as CSV for the complete dataset.`;
