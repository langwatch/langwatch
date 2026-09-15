/** Unified record count across three layouts; check contentLayout first,
 * and handle both _count.datasetRecords and recordCount (same value, different
 * Prisma projection keys). Pure — safe for server and client.
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
