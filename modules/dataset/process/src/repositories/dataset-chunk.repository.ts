import type { ChunkOffset, DatasetChunk } from "../rules/dataset-chunking.rules.ts";

/**
 * A dataset's chunked-JSONL content (ADR-032). Chunk boundaries, counts and
 * the key scheme are the shared pure rules; this names only the I/O.
 */
export interface DatasetChunkRepository {
  /**
   * Writes a record set as chunks starting at `fromIndex` (0 for a fresh
   * dataset, `chunkCount` to append). Append never rewrites existing chunks.
   */
  writeChunks(params: {
    projectId: string;
    datasetId: string;
    records: unknown[];
    fromIndex?: number;
    maxBytes?: number;
  }): Promise<DatasetChunk[]>;

  /** Every row, in order, driven by the Postgres-authoritative `chunkCount`. */
  readChunks(params: {
    projectId: string;
    datasetId: string;
    chunkCount: number;
  }): Promise<unknown[]>;

  readChunk(params: { projectId: string; datasetId: string; index: number }): Promise<unknown[]>;

  /** Overwrites one chunk with exactly these records (ADR-032 Decision 3). */
  rewriteChunk(params: {
    projectId: string;
    datasetId: string;
    index: number;
    records: unknown[];
  }): Promise<ChunkOffset>;

  /** Removes the chunks a longer earlier run left past `fromIndex` (I-IDEM). */
  deleteChunksFrom(params: {
    projectId: string;
    datasetId: string;
    fromIndex: number;
  }): Promise<void>;

  /** A file the previous release staged at `stagingKey`, for in-flight imports (ADR-155). */
  readStagedUpload(params: {
    projectId: string;
    stagingKey: string;
  }): Promise<AsyncIterable<Uint8Array>>;

  removeStagedUpload(params: { projectId: string; stagingKey: string }): Promise<void>;
}
