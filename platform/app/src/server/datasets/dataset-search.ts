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
 * Rows because every dataset has a count of them: legacy postgres-backed
 * datasets carry a null `sizeBytes` (only the s3_jsonl chunking paths write
 * it), so this is the only limit that can hold on that path at all.
 */
export const DATASET_SEARCH_MAX_ROWS = 50_000;

/**
 * How many bytes of dataset content one search will fetch and parse.
 *
 * A row count is not a measure of what a scan costs. A row is whatever columns
 * it was given: an id and a status is ~100 bytes, a stored model response is
 * tens of kilobytes, and both count as one row. Bounding rows alone therefore
 * refuses narrow datasets while waving through datasets far more expensive to
 * read — a 54,000-row dataset of 5 MB is refused while a 9,800-row dataset of
 * 18 MB is allowed, though the second is more than three times the fetching and
 * parsing.
 *
 * The number matches `DATASET_FULL_EXPORT_MAX_BYTES`, the ceiling the platform
 * already applies to reading a dataset in one request. It is written out rather
 * than imported because that constant sits in the router layer and this is the
 * domain. Search holds one chunk at a time so it is not bounded by heap the way
 * an export is, but it fetches and parses the same bytes, and there was no
 * measurement arguing for a second, different number — matching the one already
 * in use beats inventing one. If they are ever meant to move together, the
 * export constant is the one to move down here.
 *
 * Both limits apply, and neither subsumes the other: the row limit cannot see
 * how wide a row is, and this one cannot see how many rows a budget buys. It is
 * held against bytes the scan measures as it reads, not against the sizes
 * recorded on the dataset — those only decide how early a doomed scan can be
 * refused, and they are missing on the very rows most likely to need the bound.
 */
export const DATASET_SEARCH_MAX_BYTES = 100 * 1024 * 1024;

/**
 * How many postgres-backed rows are read per round of a scan.
 *
 * The s3_jsonl scan is naturally batched by chunk; the postgres scan has no
 * such unit, so it reads in slices to keep the same property — heap holds one
 * batch plus the matches kept for the page, not the whole dataset.
 */
export const DATASET_SEARCH_SCAN_BATCH = 1_000;

/**
 * How many bytes a chunk's rows occupied, measured from the rows themselves
 * rather than read off a field.
 *
 * The sizes in `chunkOffsets` are numbers a writer wrote down. They are absent
 * on rows written before sizes were recorded and on offsets an interrupted
 * migration left half-written, and nothing keeps them true afterwards. A byte
 * bound that trusts them therefore holds everywhere except on the datasets with
 * damaged or missing metadata — the only datasets where an unbounded scan is
 * reachable in the first place.
 *
 * Serialised once per chunk rather than once per row. That is not free: on a
 * 16 MB chunk it measures at roughly the parse and match it rides along with
 * put together, and it holds a second copy of the chunk as a string while it
 * runs. Both are worth paying — tens of milliseconds and one chunk of heap,
 * against fetching that chunk over the network — but the cheaper measure is a
 * real one: `readChunk` already holds the raw JSONL it parsed, so returning its
 * byte length would be exact and cost nothing. That is a change to the storage
 * interface and all three of its implementations, so it is not made here.
 *
 * The number is the JSON encoding's byte length, not the JSONL file's — array
 * punctuation stands in for the newlines. That is a byte or two per row against
 * a hundred-megabyte ceiling.
 */
export const measureRowsBytes = (rows: unknown[]): number => {
  try {
    return Buffer.byteLength(JSON.stringify(rows) ?? "");
  } catch {
    // Rows parsed from JSONL cannot hold a cycle, so this is unreachable by the
    // scan that calls it — but a chunk that cannot be measured still cost
    // something to fetch, and reporting zero would make it free and buy passage
    // for every chunk after it. One byte per row is a floor, not a reading.
    return rows.length;
  }
};

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
export const matchesDatasetSearch = ({
  entry,
  search,
}: {
  entry: Record<string, unknown>;
  search: string;
}): boolean => {
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
