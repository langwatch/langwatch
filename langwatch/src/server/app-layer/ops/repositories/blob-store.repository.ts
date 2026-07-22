import type { BlobSweepReport } from "~/server/event-sourcing/queues/groupQueue/blobSweeper";

import type {
  OpsBlobPage,
  OpsBlobSort,
  OpsBlobStoreStats,
  OpsBlobSummary,
} from "../types";

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
  }): Promise<boolean>;
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
  async deleteOne(): Promise<boolean> {
    return false;
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
