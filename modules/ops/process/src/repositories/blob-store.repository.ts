import type {
  BlobSweepReport,
  OpsBlobPage,
  OpsBlobSort,
  OpsBlobStoreStats,
  OpsBlobSummary,
} from "@langwatch/ops-contract";

/**
 * Outcome of an atomic hand delete. `refusedLiveLeases` is non-zero only
 * when refused because that many live leases referenced the blob at the
 * instant it ran - measured by the lease-guarded script, not read stale.
 */
export interface BlobDeleteResult {
  deleted: boolean;
  refusedLiveLeases: number;
}

export abstract class BlobStoreRepository {
  abstract findAllQueueNames(): Promise<string[]>;
  abstract findAll(params: {
    queueName: string;
    cursor?: string | null;
    limit: number;
    projectId?: string | null;
    sort?: OpsBlobSort;
  }): Promise<OpsBlobPage>;
  abstract tryFindById(params: {
    queueName: string;
    projectId: string;
    hash: string;
  }): Promise<OpsBlobSummary | null>;
  abstract findStats(params: { sampleLimit: number }): Promise<OpsBlobStoreStats>;
  abstract deleteOne(params: {
    queueName: string;
    projectId: string;
    hash: string;
  }): Promise<BlobDeleteResult>;
  abstract runCleanup(params: { dryRun: boolean }): Promise<BlobSweepReport>;
}

/** Used when the app has no Redis wired, so ops degrades to empty rather than throwing. */
export class NullBlobStoreRepository implements BlobStoreRepository {
  static create(): NullBlobStoreRepository {
    return new NullBlobStoreRepository();
  }

  async findAllQueueNames(): Promise<string[]> {
    return [];
  }
  async findAll(): Promise<OpsBlobPage> {
    return {
      blobs: [],
      nextCursor: null,
      sampled: 0,
      rankedFromSample: false,
    };
  }
  async tryFindById(): Promise<OpsBlobSummary | null> {
    return null;
  }
  async findStats(): Promise<OpsBlobStoreStats> {
    return { queues: [] };
  }
  async deleteOne(): Promise<BlobDeleteResult> {
    return { deleted: false, refusedLiveLeases: 0 };
  }
  async runCleanup(): Promise<BlobSweepReport> {
    return {
      queues: [],
      totals: {
        scanned: 0,
        truncated: false,
        leased: 0,
        repaired: 0,
        reclaimed: 0,
        bookkeeping: 0,
        pending: 0,
      },
      dryRun: true,
      durationMs: 0,
    };
  }
}
