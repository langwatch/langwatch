import type {
  OpsBlobPage,
  OpsBlobSort,
  OpsBlobStoreStats,
  OpsBlobSummary,
} from "../types";

/**
 * Outcome of an atomic hand delete.
 *
 * `refusedHolders` is non-zero only when the delete was refused because that
 * many holders still referenced the blob at the instant it ran — the count the
 * guarded script measured, not one read separately and now stale.
 */
export interface BlobDeleteResult {
  deleted: boolean;
  refusedHolders: number;
}

export interface BlobStoreRepository {
  findAll(params: {
    cursor?: string | null;
    limit: number;
    projectId?: string | null;
    sort?: OpsBlobSort;
  }): Promise<OpsBlobPage>;
  findById(params: {
    projectId: string;
    hash: string;
  }): Promise<OpsBlobSummary | null>;
  findStats(params: { sampleLimit: number }): Promise<OpsBlobStoreStats>;
  deleteOne(params: {
    projectId: string;
    hash: string;
  }): Promise<BlobDeleteResult>;
}

/** Used when the app has no Redis wired, so ops degrades to empty rather than throwing. */
export class NullBlobStoreRepository implements BlobStoreRepository {
  async findAll(): Promise<OpsBlobPage> {
    return {
      blobs: [],
      nextCursor: null,
      sampled: 0,
      rankedFromSample: false,
    };
  }
  async findById(): Promise<OpsBlobSummary | null> {
    return null;
  }
  async findStats(): Promise<OpsBlobStoreStats> {
    return {
      sampledBlobs: 0,
      sampledBytes: 0,
      unreferenced: 0,
      truncated: false,
    };
  }
  async deleteOne(): Promise<BlobDeleteResult> {
    return { deleted: false, refusedHolders: 0 };
  }
}
