type DatasetKey = { datasetId: string; projectId: string };

/** Which file to read, and the most bytes the caller will hold; a larger file is not read. */
export type DatasetSingleFileRead = DatasetKey & { maxBytes?: number };

/** A single-file dataset's file as stored, the fact there is none, or its size past the cap. */
export type DatasetSingleFile =
  | { outcome: "found"; text: string }
  | { outcome: "missing" }
  | { outcome: "too_large"; sizeBytes: number };

/**
 * The previous release's single-file datasets (`useS3`): one JSON array per
 * dataset, read and rewritten whole, where that release kept it.
 */
export interface DatasetSingleFileRepository {
  getSingleFile(input: DatasetSingleFileRead): Promise<DatasetSingleFile>;
  putSingleFile(input: DatasetKey & { text: string }): Promise<void>;
}
