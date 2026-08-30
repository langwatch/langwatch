import { createLogger } from "@langwatch/observability";
import { OpsSnapshotService as OpsSnapshotServiceContract } from "@langwatch/ops-contract";
import type {
  DashboardData,
  DetailSnapshot,
  LiveSnapshot,
  OpsSnapshotAbortSignal,
  OpsSnapshotLease,
} from "@langwatch/ops-contract";
import { OpsSnapshotRepository } from "../repositories/ops-snapshot.repository";

const logger = createLogger("langwatch:ops:snapshot-reader");

const READ_INTERVAL_MS = 2_000;
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

/** Process-owned snapshot reader and writer boundary. */
export class DefaultOpsSnapshotService extends OpsSnapshotServiceContract {
  private latest: DashboardData | null = null;
  private readInterval: ReturnType<typeof setInterval> | null = null;
  private readonly subscribers = new Set<(data: DashboardData) => void>();
  private badgeCache: {
    blockedCount: number;
    dlqCount: number;
    computedAt: Date;
  } | null = null;

  static create(repository: OpsSnapshotRepository): DefaultOpsSnapshotService {
    return new DefaultOpsSnapshotService(repository);
  }

  private constructor(private readonly repository: OpsSnapshotRepository) {
    super();
  }

  tryGetDashboardData(): DashboardData | null {
    return this.latest;
  }

  getBadgeCounts(): {
    blockedCount: number;
    dlqCount: number;
    computedAt: Date;
  } {
    const now = Date.now();
    if (this.badgeCache && now - this.badgeCache.computedAt.getTime() < BADGE_CACHE_TTL_MS) {
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
    if (this.readInterval) {
      return;
    }

    await this.read();
    this.readInterval = setInterval(() => void this.read(), READ_INTERVAL_MS);
  }

  stop(): void {
    if (this.readInterval) {
      clearInterval(this.readInterval);
      this.readInterval = null;
    }
    this.subscribers.clear();
  }

  async *streamDashboard({
    signal,
  }: {
    signal?: OpsSnapshotAbortSignal;
  }): AsyncIterable<DashboardData> {
    const pending: DashboardData[] = [];
    let wake: (() => void) | null = null;
    const push = (data: DashboardData): void => {
      pending.push(data);
      wake?.();
    };

    if (this.latest) {
      pending.push(this.latest);
    }
    this.subscribers.add(push);

    try {
      while (!signal?.aborted) {
        const next = pending.shift();
        if (next) {
          yield next;
          continue;
        }

        await new Promise<void>((resolve) => {
          const resume = (): void => {
            signal?.removeEventListener("abort", resume);
            wake = null;
            resolve();
          };
          wake = resume;
          signal?.addEventListener("abort", resume, { once: true });
        });
      }
    } finally {
      this.subscribers.delete(push);
    }
  }

  acquireOrRenewLease(input: { writerId: string }): Promise<OpsSnapshotLease> {
    return this.repository.acquireOrRenewLease(input);
  }

  releaseLease(): Promise<void> {
    return this.repository.releaseLease();
  }

  writeLive(input: { snapshot: LiveSnapshot; leaseToken: string }): Promise<boolean> {
    return this.repository.writeLive(input);
  }

  writeDetail(input: { snapshot: DetailSnapshot; leaseToken: string }): Promise<boolean> {
    return this.repository.writeDetail(input);
  }

  private async read(): Promise<void> {
    try {
      const [live, detail] = await Promise.all([
        this.repository.tryReadLive(),
        this.repository.tryReadDetail(),
      ]);
      const merged = this.tryMergeSnapshots({ live, detail });
      if (!merged) {
        return;
      }

      this.latest = merged;
      for (const subscriber of this.subscribers) {
        subscriber(merged);
      }
    } catch (err) {
      logger.warn({ error: err }, "Failed to read ops snapshot");
    }
  }

  private tryMergeSnapshots({
    live,
    detail,
  }: {
    live: LiveSnapshot | null;
    detail: DetailSnapshot | null;
  }): DashboardData | null {
    if (!live) {
      return null;
    }

    return {
      totalGroups: live.totalGroups,
      blockedGroups: live.queues.reduce((sum, queue) => {
        return sum + queue.blockedGroupCount;
      }, 0),
      parkedGroups: live.queues.reduce((sum, queue) => {
        return sum + queue.parkedGroupCount;
      }, 0),
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
      latencyWindows: detail?.latencyWindows ?? null,
      pausedKeys: live.pausedKeys,
      pipelineTree: detail?.pipelineTree ?? [],
      phases: detail?.phases ?? {
        commands: { ...EMPTY_PHASE },
        projections: { ...EMPTY_PHASE },
        reactions: { ...EMPTY_PHASE },
      },
      jobNameMetrics: detail?.jobNameMetrics ?? [],
      topErrors: detail?.topErrors ?? [],
      errorClustersBound: detail?.errorClustersBound ?? {
        included: 0,
        total: 0,
      },
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
}
