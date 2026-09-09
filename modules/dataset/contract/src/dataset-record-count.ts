/**
 * The record count to display for a dataset, unified across all THREE storage
 * layouts so the REST list, the tRPC list and every UI surface agree:
 *
 *   - `s3_jsonl` (chunked, born-on-storage): rows live in chunk objects, NOT the
 *     `DatasetRecord` table, so the entries-table count is 0 — the authoritative
 *     count is the PG-mirrored `rowCount`.
 *   - legacy single-blob `useS3`: `s3RecordCount`.
 *   - `postgres`: the `DatasetRecord` table count.
 *
 * Born-on-storage sets `contentLayout='s3_jsonl'` but leaves the legacy `useS3`
 * flag false, so a `useS3`-only check would fall through to the entries count
 * and report 0 for every new dataset. Check `contentLayout` first.
 *
 * THE ENTRIES-TABLE COUNT ARRIVES UNDER TWO NAMES, and both are read. A Prisma
 * row included with `_count: { select: { datasetRecords: true } }` carries
 * `_count.datasetRecords`; `DatasetSummary` — what `listDatasets` returns and
 * therefore what the `dataset.getAll` procedure hands the datasets list page —
 * carries the SAME number projected onto `recordCount`
 * (`prisma.dataset.repository.list`). Reading only `_count` reported 0 for every
 * postgres-layout dataset on the list page, because that key does not survive
 * the repository's projection.
 *
 * Pure (no imports) — safe to import from both server and client.
 */
export const datasetDisplayRecordCount = (dataset: {
  contentLayout?: string | null;
  useS3?: boolean | null;
  rowCount?: number | null;
  s3RecordCount?: number | null;
  recordCount?: number | null;
  _count?: { datasetRecords: number } | null;
}): number => {
  if (dataset.contentLayout === "s3_jsonl") {
    return dataset.rowCount ?? 0;
  }
  if (dataset.useS3) {
    return dataset.s3RecordCount ?? 0;
  }
  return dataset._count?.datasetRecords ?? dataset.recordCount ?? 0;
};
