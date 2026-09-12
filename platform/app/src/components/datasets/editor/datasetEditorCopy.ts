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
 * The count chip while a search is in effect.
 *
 * Both numbers, because either alone misleads: the match count on its own reads
 * as the dataset having shrunk, and the dataset total on its own hides the
 * result of the search that was just run.
 *
 * `total` is omitted when no unsearched read has settled yet, so the dataset's
 * own size genuinely is not known. Reusing the match count for both halves
 * would render "1 of 1 records" for a dataset of 120 — the exact misreading the
 * pair exists to prevent — so the chip says less instead of saying something
 * false.
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

/**
 * Shown in place of the grid when a search matched nothing. Repeats the text
 * that was searched for: with a debounce between typing and results, the user
 * needs to see which search this empty result belongs to.
 */
/** The count chip with no search in effect: "679 records", "1 record". */
export const plainRecordCount = (count: number): string =>
  `${formatRecordCount(count)} ${count === 1 ? "record" : "records"}`;

/**
 * Shown in the grid when the server refused or failed the search.
 *
 * The toast carries the reason and then dismisses; this stays, so the screen
 * never settles into looking like a search that returned something.
 */
export const searchFailedMessage = (search: string): string =>
  `Couldn’t run the search for “${search}”.`;

export const noSearchMatchesMessage = (search: string): string =>
  `No records match “${search}”.`;

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
