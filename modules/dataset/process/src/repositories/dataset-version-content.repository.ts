import type { DatasetVersionRow } from "@langwatch/dataset-contract";

/** A version's rows, as JSONL chunks of a fixed row count in object storage. */
export interface DatasetVersionContentRepository {
  writeChunk(input: {
    projectId: string;
    datasetId: string;
    versionId: string;
    index: number;
    rows: readonly DatasetVersionRow[];
  }): Promise<void>;
  readChunk(input: {
    projectId: string;
    datasetId: string;
    versionId: string;
    index: number;
  }): Promise<unknown[]>;
  deleteChunks(input: {
    projectId: string;
    datasetId: string;
    versionId: string;
    chunkCount: number;
  }): Promise<void>;
}
