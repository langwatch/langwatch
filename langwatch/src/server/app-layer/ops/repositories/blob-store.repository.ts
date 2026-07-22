import type { BlobSweepReport } from "~/server/event-sourcing/queues/groupQueue/blobSweeper";

/**
 * One content-addressed blob as the ops surface sees it.
 *
 * Deliberately carries no bytes. The body is customer payload, and an operator
 * browsing retention needs to know how big a blob is and whether anything still
 * references it, never what is inside it.
 */
export interface OpsBlobSummary {
  queueName: string;
  projectId: string;
  hash: string;
  /** Serialized size in bytes. */
  sizeBytes: number;
  /** Seconds until expiry; null when the key carries no expiry at all. */
  ttlSeconds: number | null;
  /** Lease holders whose deadline has not passed. */
  liveLeases: number;
  /** Mirrored holder tokens, excluding the rolling-deploy sentinel. */
  holderTokens: number;
  /**
   * What a sweep would decide for this blob right now, so the browser and the
   * runner can never tell an operator two different stories.
   */
  sweepOutcome: string;
}

export interface OpsBlobPage {
  blobs: OpsBlobSummary[];
  /** Opaque; pass back to continue. Null when the walk is finished. */
  nextCursor: string | null;
}

export interface OpsBlobStoreStats {
  queues: Array<{
    queueName: string;
    /** Sampled, not exact: a full count of a multi-million-key keyspace is not a request-time operation. */
    sampledBlobs: number;
    sampledBytes: number;
    unreferenced: number;
    truncated: boolean;
  }>;
}

export interface BlobStoreRepository {
  findAllQueueNames(): Promise<string[]>;
  findAll(params: {
    queueName: string;
    cursor?: string | null;
    limit: number;
    projectId?: string | null;
  }): Promise<OpsBlobPage>;
  findById(params: {
    queueName: string;
    projectId: string;
    hash: string;
  }): Promise<OpsBlobSummary | null>;
  getStats(params: { sampleLimit: number }): Promise<OpsBlobStoreStats>;
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
    return { blobs: [], nextCursor: null };
  }
  async findById(): Promise<OpsBlobSummary | null> {
    return null;
  }
  async getStats(): Promise<OpsBlobStoreStats> {
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
