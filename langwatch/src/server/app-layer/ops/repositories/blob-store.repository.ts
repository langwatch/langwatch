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
   * Earliest deadline in the lease set, in Redis-time ms; null when no lease
   * member remains at all.
   *
   * When this is in the past it dates the blob's oldest LAPSED lease — i.e. how
   * long ago the holder that should have released it stopped renewing. That is
   * the sharpest available signal for "a worker died here", which is what
   * strands blobs in the first place.
   */
  earliestLeaseDeadlineMs: number | null;
  /**
   * What a sweep would decide for this blob right now, so the browser and the
   * runner can never tell an operator two different stories.
   */
  sweepOutcome: string;
}

/**
 * How a listing is ordered.
 *
 * `scan` is the only exhaustive mode: it walks the keyspace in Redis cursor
 * order, which is arbitrary but complete and resumable. Every other mode is a
 * RANKED SAMPLE — a keyspace of millions cannot be globally sorted inside a
 * request, so those modes read a bounded window, order it, and report how much
 * they looked at. That is the honest trade: "largest in the 20k we sampled",
 * never "largest that exists".
 */
export const OPS_BLOB_SORTS = [
  /** Cursor order. Exhaustive and resumable; no ranking. */
  "scan",
  /** Biggest payloads first — what is actually occupying the instance. */
  "largest",
  /**
   * Least recently touched first. Every access re-arms the blob to the full
   * backstop, so a LOW remaining TTL means nothing has read or staged it in a
   * long time. This is the closest thing to "oldest" the store can answer:
   * blobs carry no creation timestamp.
   */
  "stalest",
  /** Nothing holds a live lease — the reclaimable set, biggest first. */
  "unreferenced",
  /** Longest-lapsed lease first: where a holder most likely died mid-flight. */
  "oldest_lapsed_lease",
] as const;

export type OpsBlobSort = (typeof OPS_BLOB_SORTS)[number];

export interface OpsBlobPage {
  blobs: OpsBlobSummary[];
  /** Opaque; pass back to continue. Null when the walk is finished. */
  nextCursor: string | null;
  /** Blobs examined to produce this page. */
  sampled: number;
  /**
   * True when ranking could not see the whole keyspace, so the order is a
   * best-of-sample rather than a true top-N. Always false for `scan`.
   */
  rankedFromSample: boolean;
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
    sort?: OpsBlobSort;
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
