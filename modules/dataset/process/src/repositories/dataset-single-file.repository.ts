type DatasetKey = { datasetId: string; projectId: string };

/** A single-file dataset's file as the previous release left it, or the fact that it left none. */
export type DatasetSingleFile = { outcome: "found"; text: string } | { outcome: "missing" };

/**
 * The previous release's single-file datasets (`useS3`): one JSON array per
 * dataset, read only by the content move that copies it into chunks.
 */
export interface DatasetSingleFileRepository {
  getSingleFile(input: DatasetKey): Promise<DatasetSingleFile>;
}
