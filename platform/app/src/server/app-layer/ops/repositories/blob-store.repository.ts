import type { BlobSweepReport } from "~/server/event-sourcing/queues/groupQueue/blobSweeper";

import type {
  OpsBlobPage,
  OpsBlobSort,
  OpsBlobStoreStats,
  OpsBlobSummary,
} from "../types";

/**
 * Outcome of an atomic hand delete.
 *
 * `refusedLiveLeases` is non-zero only when the delete was refused because that
 * many live leases still referenced the blob at the instant it ran — the count
 * the lease-guarded script measured, not one read separately and now stale.
 */
export interface BlobDeleteResult {
  deleted: boolean;
  refusedLiveLeases: number;
}

export interface BlobStoreRepository {
  findAllQueueNames(): Promise<string[]>;
  findAll(params: {
    queueName: string;
    cursor?: string | null;
    limit: number;
    projectId?: string | null;
    sort?: OpsBlobSort;
  }): Promise<OpsBlobPage>;
  findById(params: {
    queueName: string;
    projectId: string;
    hash: string;
  }): Promise<OpsBlobSummary | null>;
  findStats(params: { sampleLimit: number }): Promise<OpsBlobStoreStats>;
  deleteOne(params: {
    queueName: string;
    projectId: string;
    hash: string;
  }): Promise<BlobDeleteResult>;
  runCleanup(params: { dryRun: boolean }): Promise<BlobSweepReport>;
}

/** Used when the app has no Redis wired, so ops degrades to empty rather than throwing. */
export class NullBlobStoreRepository implements BlobStoreRepository {
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
  async findById(): Promise<OpsBlobSummary | null> {
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
