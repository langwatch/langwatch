/**
 * Row search for the dataset editor.
 *
 * A dataset of a few hundred rows is ~14 pages at the editor's page size, and
 * paging is a poor way to find one row. Search narrows the dataset to the rows
 * whose cell VALUES contain the text, and the pager then pages the matches.
 *
 * The predicate lives here rather than in the service because both storage
 * layouts have to agree on it: s3_jsonl content is scanned chunk-by-chunk in
 * the app, and postgres-backed content is filtered from the record rows. If the
 * two disagreed, the same search would return different rows depending on where
 * the dataset happens to be stored — a difference the user cannot see or explain.
 */

/**
 * How many rows one search will read.
 *
 * Rows, not bytes: legacy postgres-backed datasets carry a null `sizeBytes`
 * (only the s3_jsonl chunking paths write it), so a byte cap would never fire
 * for them. And the real cost of searching an s3_jsonl dataset is the chunk
 * reads, which scale with rows, not with the heap held at any one moment — the
 * scan keeps one chunk in memory at a time.
 */
export const DATASET_SEARCH_MAX_ROWS = 50_000;

/**
 * How many postgres-backed rows are read per round of a scan.
 *
 * The s3_jsonl scan is naturally batched by chunk; the postgres scan has no
 * such unit, so it reads in slices to keep the same property — heap holds one
 * batch plus the matches kept for the page, not the whole dataset.
 */
export const DATASET_SEARCH_SCAN_BATCH = 1_000;

/**
 * Reduce a raw search input to the text to match on, or `undefined` when there
 * is nothing to search for. Whitespace-only input is "no search" rather than a
 * search for a space, which would match almost every row.
 */
export const normalizeDatasetSearch = (
  search: string | undefined | null,
): string | undefined => {
  const trimmed = search?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * True when one of the entry's values contains `search`, case-insensitively.
 *
 * Values only, never the column names: a dataset with a `conversation_id`
 * column would otherwise return every one of its rows for the search "id", and
 * nothing on screen would explain why. Non-string values are stringified so a
 * search for "4" finds a numeric cell; null and undefined never match, so
 * searching "null" does not select every row with an empty cell.
 *
 * `search` is expected to have been through `normalizeDatasetSearch`.
 */
export const matchesDatasetSearch = (
  entry: Record<string, unknown>,
  search: string,
): boolean => {
  // `entry` is whatever was stored: `adaptS3JsonlRecord` assigns it straight
  // from a JSONL line with no shape check, so a line of `null` or a bare scalar
  // reaches here. Ordinary paging tolerates such a row and renders it blank —
  // a search must not be the one path that throws on it, because throwing here
  // fails the WHOLE search rather than skipping the one unreadable row.
  if (entry === null || typeof entry !== "object") return false;

  const needle = search.toLowerCase();

  return Object.values(entry).some((value) => {
    if (value === null || value === undefined) return false;

    const haystack =
      typeof value === "string" ? value : safeStringifyValue(value);

    return haystack.toLowerCase().includes(needle);
  });
};

/**
 * Objects and arrays are searched by their JSON text, which is what the editor
 * renders in the cell. A value that cannot be serialised (a cycle, a BigInt)
 * falls back to `String(...)` rather than throwing mid-scan and failing the
 * whole search over one bad cell.
 */
const safeStringifyValue = (value: unknown): string => {
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? "";
    } catch {
      return String(value);
    }
  }
  return String(value);
};
