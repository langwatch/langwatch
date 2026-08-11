import { EventEmitter } from "node:events";
import { createLogger } from "@langwatch/observability";
import type { DashboardData } from "../types";
import type { SnapshotRepository } from "./snapshot.repository";
import type { DetailSnapshot, LiveSnapshot } from "./snapshot.types";

const logger = createLogger("langwatch:ops:snapshot-reader");

export const DASHBOARD_EVENT = "dashboard";

const READ_INTERVAL_MS = 2_000;
/** Badge callers share one computation for this long; see `getBadgeCounts`. */
const BADGE_CACHE_TTL_MS = 5_000;

const EMPTY_PHASE = {
  pending: 0,
  active: 0,
  completedPerSec: 0,
  failedPerSec: 0,
  latencyP50Ms: 0,
  latencyP99Ms: 0,
  peakCompletedPerSec: 0,
  peakFailedPerSec: 0,
  peakLatencyP50Ms: 0,
  peakLatencyP99Ms: 0,
} as const;

/**
 * Assemble the dashboard payload from the two persisted artifacts (ADR-090).
 *
 * Exported for tests: the merge is where "two pods serve identical data" is
 * either true or not, so it is worth exercising without a Redis.
 */
export function mergeSnapshots({
  live,
  detail,
}: {
  live: LiveSnapshot | null;
  detail: DetailSnapshot | null;
}): DashboardData | null {
  // Without a live artifact there are no counts to render. Serving the detail
  // alone would show clusters and parked tenants beside zeroed totals, which
  // reads as "everything drained" rather than "nothing loaded yet".
  if (!live) return null;

  return {
    totalGroups: live.totalGroups,
    blockedGroups: live.queues.reduce((s, q) => s + q.blockedGroupCount, 0),
    parkedGroups: live.queues.reduce((s, q) => s + q.parkedGroupCount, 0),
    totalPendingJobs: live.totalPendingJobs,
    pendingDrift: live.pendingDrift,
    throughputIngestedPerSec: live.throughputIngestedPerSec,
    totalCompleted: live.totalCompleted,
    totalFailed: live.totalFailed,
    completedPerSec: live.completedPerSec,
    failedPerSec: live.failedPerSec,
    peakCompletedPerSec: live.peakCompletedPerSec,
    peakFailedPerSec: live.peakFailedPerSec,
    peakIngestedPerSec: live.peakIngestedPerSec,
    redisMemoryUsedBytes: live.redisMemoryUsedBytes,
    redisMemoryPeakBytes: live.redisMemoryPeakBytes,
    redisMemoryMaxBytes: live.redisMemoryMaxBytes,
    redisConnectedClients: live.redisConnectedClients,
    redisEngineCpuPercent: live.redisEngineCpuPercent,
    processCpuPercent: live.processCpuPercent,
    processMemoryUsedMb: live.processMemoryUsedMb,
    processMemoryTotalMb: live.processMemoryTotalMb,
    throughputHistory: live.throughputHistory,
    queues: live.queues,
    latencyP50Ms: live.latencyP50Ms,
    latencyP99Ms: live.latencyP99Ms,
    peakLatencyP50Ms: live.peakLatencyP50Ms,
    peakLatencyP99Ms: live.peakLatencyP99Ms,
    pausedKeys: live.pausedKeys,

    // Detail lags live by design. Its absence renders as "nothing to show
    // yet" — empty structure beside real counts — never as fabricated zeros
    // presented as exhaustive truth.
    pipelineTree: detail?.pipelineTree ?? [],
    phases: detail?.phases ?? {
      commands: { ...EMPTY_PHASE },
      projections: { ...EMPTY_PHASE },
      reactions: { ...EMPTY_PHASE },
    },
    jobNameMetrics: detail?.jobNameMetrics ?? [],
    topErrors: detail?.topErrors ?? [],
    errorClustersBound: detail?.errorClustersBound ?? { included: 0, total: 0 },
    parkedTenants: detail?.parkedTenants ?? [],
    parkedTenantsBound: detail?.parkedTenantsBound ?? {
      included: 0,
      total: 0,
    },

    snapshot: {
      computedAt: live.computedAt,
      detailComputedAt: detail?.computedAt ?? null,
      writerId: live.writerId,
      leaseEpoch: live.leaseEpoch,
    },
  };
}

/**
 * Serves the shared snapshot to this pod's dashboard subscribers (ADR-090).
 *
 * Every pod runs one, writer included. It never scans: it polls the two Redis
 * keys the elected writer maintains and broadcasts what it finds, which is what
 * makes two browser tabs on different pods agree.
 */
export class OpsSnapshotReader {
  private latest: DashboardData | null = null;
  private readInterval: ReturnType<typeof setInterval> | null = null;
  private emitter = new EventEmitter();
  private badgeCache: {
    blockedCount: number;
    dlqCount: number;
    computedAt: Date;
  } | null = null;

  constructor(private readonly repo: SnapshotRepository) {
    // One listener per tRPC subscriber; the dashboard is admin-only, so raise
    // the cap for multi-tab use without losing the leak signal entirely.
    this.emitter.setMaxListeners(100);
  }

  getEmitter(): EventEmitter {
    return this.emitter;
  }

  /** Null until a snapshot this reader understands has been read. */
  getDashboardData(): DashboardData | null {
    return this.latest;
  }

  /**
   * The two integers the global nav badge renders.
   *
   * Memoized so a burst of concurrent callers (several tabs, a layout remount)
   * shares one computation, and stamped with `computedAt` so the caller can
   * tell how stale the answer is.
   */
  getBadgeCounts(): {
    blockedCount: number;
    dlqCount: number;
    computedAt: Date;
  } {
    const now = Date.now();
    if (
      this.badgeCache &&
      now - this.badgeCache.computedAt.getTime() < BADGE_CACHE_TTL_MS
    ) {
      return this.badgeCache;
    }

    let blockedCount = 0;
    let dlqCount = 0;
    for (const q of this.latest?.queues ?? []) {
      blockedCount += q.blockedGroupCount;
      dlqCount += q.dlqCount;
    }
    this.badgeCache = { blockedCount, dlqCount, computedAt: new Date(now) };
    return this.badgeCache;
  }

  async start(): Promise<void> {
    await this.read();
    this.readInterval = setInterval(() => void this.read(), READ_INTERVAL_MS);
  }

  stop(): void {
    if (this.readInterval) {
      clearInterval(this.readInterval);
      this.readInterval = null;
    }
    this.emitter.removeAllListeners();
  }

  async read(): Promise<void> {
    try {
      const [live, detail] = await Promise.all([
        this.repo.readLive(),
        this.repo.readDetail(),
      ]);
      const merged = mergeSnapshots({ live, detail });
      // A read that finds nothing readable keeps the last good payload rather
      // than blanking the dashboard: an unreadable snapshot is a reason to stop
      // updating, not a reason to claim the platform went quiet.
      if (!merged) return;
      this.latest = merged;
      if (this.emitter.listenerCount(DASHBOARD_EVENT) > 0) {
        this.emitter.emit(DASHBOARD_EVENT, merged);
      }
    } catch (err) {
      logger.warn({ error: err }, "Failed to read ops snapshot");
    }
  }
}

let singleton: OpsSnapshotReader | null = null;

export function getOpsSnapshotReader(
  repo: SnapshotRepository,
): OpsSnapshotReader {
  if (!singleton) {
    singleton = new OpsSnapshotReader(repo);
    singleton.start().catch((err) => {
      logger.error({ error: err }, "Failed to start ops snapshot reader");
    });
  }
  return singleton;
}
