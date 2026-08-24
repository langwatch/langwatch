/** Tenant-prefixed, ordered chunk key for the object-backed dataset layout. */
export const chunkKey = (
  projectId: string,
  datasetId: string,
  index: number,
): string =>
  `datasets/${projectId}/${datasetId}/chunk-${String(index).padStart(5, "0")}.jsonl`;
