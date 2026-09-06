/**
 * The record count to display for a dataset, unified across all THREE storage
 * layouts so the REST list, the tRPC list and every UI surface agree:
 *
 *   - `s3_jsonl` (chunked, born-on-storage): rows live in chunk objects, NOT the
 *     `DatasetRecord` table, so `_count.datasetRecords` is 0 — the authoritative
 *     count is the PG-mirrored `rowCount`.
 *   - legacy single-blob `useS3`: `s3RecordCount`.
 *   - `postgres`: the `DatasetRecord` table count (`_count.datasetRecords`).
 *
 * Born-on-storage sets `contentLayout='s3_jsonl'` but leaves the legacy `useS3`
 * flag false, so a `useS3`-only check would fall through to `_count` and report
 * 0 for every new dataset. Check `contentLayout` first.
 *
 * Pure (no imports) — safe to import from both server and client.
 */
export const datasetDisplayRecordCount = (dataset: {
  contentLayout?: string | null;
  useS3?: boolean | null;
  rowCount?: number | null;
  s3RecordCount?: number | null;
  _count?: { datasetRecords: number } | null;
}): number => {
  if (dataset.contentLayout === "s3_jsonl") {
    return dataset.rowCount ?? 0;
  }
  if (dataset.useS3) {
    return dataset.s3RecordCount ?? 0;
  }
  return dataset._count?.datasetRecords ?? 0;
};
