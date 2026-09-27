/** Row search by cell content value (not columns). Predicate shared to keep
 * same rows across storage layouts (s3_jsonl vs postgres).
 */

/**
 * How many rows one search will read. Legacy postgres-backed datasets carry
 * a null `sizeBytes` (only s3_jsonl chunking writes it), so this row limit
 * is the only one that can hold on that path at all.
 */
export const DATASET_SEARCH_MAX_ROWS = 50_000;

/** Row cost isn't measured by count; byte limit necessary. Measured during
 * scan, not from dataset metadata (which can be missing/stale).
 */
export const DATASET_SEARCH_MAX_BYTES = 100 * 1024 * 1024;

/**
 * How many postgres-backed rows are read per scan round. s3_jsonl is
 * naturally batched by chunk; postgres has no such unit, so it slices to
 * keep the same property — heap holds one batch plus the page's matches.
 */
export const DATASET_SEARCH_SCAN_BATCH = 1_000;

/** Chunk byte size measured from rows (metadata unreliable). Serialized once
 * per chunk; JSON encoding, not JSONL file bytes.
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
export const normalizeDatasetSearch = (search: string | undefined | null): string | undefined => {
  const trimmed = search?.trim();
  return trimmed ? trimmed : undefined;
};

/** Search matches cell values only (not columns), case-insensitive. Non-string
 * values stringified; null/undefined never match.
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

    const haystack = typeof value === "string" ? value : safeStringifyValue(value);

    return haystack.toLowerCase().includes(needle);
  });
};

/**
 * Objects and arrays are searched by their JSON text — what the editor
 * renders in the cell. A value that can't serialise (a cycle, a BigInt)
 * falls back to a placeholder rather than failing the whole search.
 */
const safeStringifyValue = (value: unknown): string => {
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? "";
    } catch {
      return "[unserializable value]";
    }
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
};
