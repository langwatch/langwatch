/**
 * One lane as the operator console sees it.
 *
 * A lane is the unit the dispatch plane serialises on, so it is also the unit
 * an operator recovers: it is what gets leased, what backs off, and what gets
 * parked. `laneId` is the rendered group key, which parses back to the tenant,
 * lane and scope that produced it.
 */
export interface LaneInfo {
  laneId: string;
  tenantId: string;
  laneKind: string;
  /** Null only for the aggregate-serialised command lane, which carries no name. */
  laneName: string | null;
  pendingJobs: number;
  /** Ordering key of the head job; null when the lane is empty. */
  headOrderingKey: number | null;
  /** A live lease's remaining ms; null when nothing holds the lane. */
  leaseRemainingMs: number | null;
  /** A parked lane stops being claimable until an operator unparks it. */
  isParked: boolean;
  /** Why the consumer parked it. */
  parkReason: string | null;
  /** A retry's backoff deadline in epoch ms; null when claimable now. */
  readyAtMs: number | null;
  /** Highest attempt across the lane's staged jobs. */
  attempts: number;
}

export interface LaneKindInfo {
  name: string;
  displayName: string;
  laneCount: number;
  parkedLaneCount: number;
  leasedLaneCount: number;
  totalPendingJobs: number;
  lanes: LaneInfo[];
}

export type LaneKindSummary = Omit<LaneKindInfo, "lanes">;

export interface ThroughputPoint {
  timestamp: number;
  pendingCount: number;
  parkedCount: number;
  leasedCount: number;
}

export interface ErrorCluster {
  normalizedMessage: string;
  sampleMessage: string;
  count: number;
  laneKind: string;
  sampleLaneIds: string[];
}

export interface RedisInfo {
  usedMemoryHuman: string;
  peakMemoryHuman: string;
  usedMemoryBytes: number;
  peakMemoryBytes: number;
  maxMemoryBytes: number;
  connectedClients: number;
  // Engine CPU is derived between successive INFO cpu samples. We expose the
  // raw cumulative counters here so the collector can diff them across collect
  // cycles without a second piece of state.
  usedCpuUserMainThreadSeconds: number;
  usedCpuSysMainThreadSeconds: number;
}

/**
 * What the dashboard can read straight off Redis.
 *
 * Depth, lease and park state are lane keys, so they are answerable here.
 * Throughput, latency and failure rates are not: the dispatch plane reports
 * those through its `Metrics` port (ADR-108), which is scraped, not stored in
 * Redis — reading them back out of the keyspace would mean inventing counters
 * nothing writes.
 */
export interface DashboardData {
  totalLanes: number;
  parkedLanes: number;
  leasedLanes: number;
  totalPendingJobs: number;
  redisMemoryUsedBytes: number;
  redisMemoryPeakBytes: number;
  redisMemoryMaxBytes: number;
  redisConnectedClients: number;
  // null on the first collection cycle (need two samples to derive a rate)
  // and on the cycle immediately after a Redis restart (cumulative counters
  // go backwards). Rounded to one decimal place when present.
  redisEngineCpuPercent: number | null;
  processCpuPercent: number;
  processMemoryUsedMb: number;
  processMemoryTotalMb: number;
  throughputHistory: ThroughputPoint[];
  laneKinds: LaneKindSummary[];
  topParkReasons: ErrorCluster[];
}

export type SSEEvent =
  | { type: "dashboard"; data: DashboardData }
  | { type: "heartbeat"; data: { timestamp: number } };

/**
 * One content-addressed blob as the ops surface sees it.
 *
 * Deliberately carries no bytes. The body is customer payload, and an operator
 * browsing retention needs to know how big a blob is and whether anything still
 * references it, never what is inside it.
 */
export interface OpsBlobSummary {
  /** The spool namespaces by tenant, which in this app is the project. */
  projectId: string;
  hash: string;
  /** Bytes resident in Redis; zero for a body spooled to the durable store. */
  sizeBytes: number;
  tier: "redis" | "durable";
  /** Seconds until expiry; null when the key carries no expiry at all. */
  ttlSeconds: number | null;
  /**
   * Holders that put the blob and have not released it. Zero means the spool's
   * own grace TTL is already running it down — the reclaimable set.
   */
  holders: number;
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
   * Least recently touched first. Every put re-arms the blob to the full
   * backstop, so a LOW remaining TTL means nothing has staged it in a long
   * time. This is the closest thing to "oldest" the store can answer: blobs
   * carry no creation timestamp.
   */
  "stalest",
  /** Nothing holds it — the reclaimable set, biggest first. */
  "unreferenced",
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
  /** Sampled, not exact: a full count of a multi-million-key keyspace is not a request-time operation. */
  sampledBlobs: number;
  sampledBytes: number;
  unreferenced: number;
  truncated: boolean;
}
