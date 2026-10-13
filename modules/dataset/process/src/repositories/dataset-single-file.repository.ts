type DatasetKey = { datasetId: string; projectId: string };

/** A single-file dataset's file as stored, or the fact that there is none. */
export type DatasetSingleFile = { outcome: "found"; text: string } | { outcome: "missing" };

/**
 * The previous release's single-file datasets (`useS3`): one JSON array per
 * dataset, read and rewritten whole, where that release kept it.
 */
export interface DatasetSingleFileRepository {
  getSingleFile(input: DatasetKey): Promise<DatasetSingleFile>;
  putSingleFile(input: DatasetKey & { text: string }): Promise<void>;
}
