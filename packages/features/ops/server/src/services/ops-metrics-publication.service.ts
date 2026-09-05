/**
 * What the fleet's one writer publishes: the cheap live artifact every cycle, and the exhaustive
 * detail scan on its own slower cadence. Both writes are fenced on the lease token held when the
 * work started, so a scan that outlives its lease is discarded rather than overwriting a successor.
 */

import * as os from "node:os";
import { createLogger } from "@langwatch/observability";
import { SNAPSHOT_VERSION } from "@langwatch/ops-contract";
import type {
  DashboardData,
  DetailSnapshot,
  OpsService,
  OpsSnapshotService,
  QueueInfo,
} from "@langwatch/ops-contract";
import { OpsDashboardViewService } from "./ops-dashboard-view.service";
import type { OpsMetricsSamplingService } from "./ops-metrics-sampling.service";
import type { OpsMetricsWindow } from "./ops-metrics-window.service";

const logger = createLogger("langwatch:ops:metrics-publication");

/**
 * The live cycle is cheap and stays at 2s; the detail cycle walks every blocked set in full and
 * enumerates parked tenants, which is only affordable because ONE writer in the fleet runs it.
 * Fifteen seconds keeps the drill-downs fresh while leaving the exhaustive work in the background.
 */
const DETAIL_CYCLE_INTERVAL_MS = 15_000;

/** Bounds on the detail artifact. Every one of these reports itself. */
const MAX_ERROR_CLUSTERS = 50;
const MAX_PARKED_TENANTS = 50;

export class OpsMetricsPublicationService {
  private lastDetailAt = 0;
  private detailInFlight = false;
  /** Latest scan, held so a reader can have what this writer most recently produced. */
  private latestDetail: DetailSnapshot | null = null;

  private constructor(
    private readonly ops: OpsService,
    private readonly sampling: OpsMetricsSamplingService,
    private readonly window: OpsMetricsWindow,
    private readonly writerId: string,
    private readonly queueNames: () => string[],
    private readonly lease: () => { token: string | null; epoch: number },
    private readonly snapshots: OpsSnapshotService | null,
  ) {}

  static create(params: {
    ops: OpsService;
    sampling: OpsMetricsSamplingService;
    window: OpsMetricsWindow;
    writerId: string;
    queueNames: () => string[];
    lease: () => { token: string | null; epoch: number };
    snapshots: OpsSnapshotService | null;
  }): OpsMetricsPublicationService {
    return new OpsMetricsPublicationService(
      params.ops,
      params.sampling,
      params.window,
      params.writerId,
      params.queueNames,
      params.lease,
      params.snapshots,
    );
  }

  /** This writer's own view of the dashboard, which is also what it publishes. */
  dashboardData(): DashboardData {
    return OpsDashboardViewService.build({
      window: this.window,
      latestDetail: this.latestDetail,
      writerId: this.writerId,
      leaseEpoch: this.lease().epoch,
    });
  }

  async publishLive(): Promise<void> {
    if (!this.snapshots) {
      return;
    }

    const leaseToken = this.lease().token;
    if (!leaseToken) {
      return;
    }

    const data = this.dashboardData();
    const mem = process.memoryUsage();
    try {
      await this.snapshots.writeLive({
        leaseToken,
        snapshot: {
          version: SNAPSHOT_VERSION,
          computedAt: Date.now(),
          writerId: this.writerId,
          leaseEpoch: this.lease().epoch,
          queues: data.queues,
          totalGroups: data.totalGroups,
          totalPendingJobs: data.totalPendingJobs,
          pendingDrift: data.pendingDrift,
          throughputIngestedPerSec: data.throughputIngestedPerSec,
          completedPerSec: data.completedPerSec,
          failedPerSec: data.failedPerSec,
          totalCompleted: data.totalCompleted,
          totalFailed: data.totalFailed,
          peakCompletedPerSec: data.peakCompletedPerSec,
          peakFailedPerSec: data.peakFailedPerSec,
          peakIngestedPerSec: data.peakIngestedPerSec,
          latencyP50Ms: data.latencyP50Ms,
          latencyP99Ms: data.latencyP99Ms,
          peakLatencyP50Ms: data.peakLatencyP50Ms,
          peakLatencyP99Ms: data.peakLatencyP99Ms,
          redisMemoryUsedBytes: data.redisMemoryUsedBytes,
          redisMemoryPeakBytes: data.redisMemoryPeakBytes,
          redisMemoryMaxBytes: data.redisMemoryMaxBytes,
          redisConnectedClients: data.redisConnectedClients,
          redisEngineCpuPercent: data.redisEngineCpuPercent,
          processCpuPercent: data.processCpuPercent,
          processMemoryUsedMb: Math.round(mem.rss / 1024 / 1024),
          processMemoryTotalMb: Math.round(os.totalmem() / 1024 / 1024),
          pausedKeys: data.pausedKeys,
          throughputHistory: data.throughputHistory,
        },
      });
    } catch (err) {
      logger.warn({ error: err }, "Failed to publish live ops snapshot");
    }
  }

  /**
   * Exhaustive artifact, on its own slower cadence.
   */
  maybePublishDetail(queues: QueueInfo[]): void {
    if (!this.snapshots) {
      return;
    }

    const snapshots = this.snapshots;
    if (this.detailInFlight) {
      return;
    }

    if (Date.now() - this.lastDetailAt < DETAIL_CYCLE_INTERVAL_MS) {
      return;
    }

    // Captured BEFORE the scan: a slow detail scan can outlive the lease it
    // started under, and the write must be fenced on that lease rather than on
    // whatever the pod holds by the time the scan finishes.
    const tokenAtScanStart = this.lease().token;
    if (!tokenAtScanStart) {
      return;
    }

    this.detailInFlight = true;
    void this.runDetailScan({ queues, leaseToken: tokenAtScanStart, snapshots }).finally(() => {
      this.detailInFlight = false;
    });
  }

  /**
   * The exhaustive scan itself. Its write is fenced on the lease held when it started, and only an
   * accepted write is adopted: a rejected one was never published, so keeping it would report a
   * detail artifact no reader can see.
   */
  private async runDetailScan({
    queues,
    leaseToken,
    snapshots,
  }: {
    queues: QueueInfo[];
    leaseToken: string;
    snapshots: OpsSnapshotService;
  }): Promise<void> {
    try {
      const [blocked, parked, latencyWindows] = await Promise.all([
        this.ops.getBlockedQueueSummary(),
        this.ops.listParkedQueueTenants({
          queueNames: this.queueNames(),
          maxTenants: MAX_PARKED_TENANTS,
        }),
        this.sampling.computeLatencyWindows(this.queueNames()),
      ]);

      const treeSeedKeys = [
        ...new Set([...this.window.currentPausedKeys, ...this.window.knownPipelinePaths]),
      ];

      const detail: DetailSnapshot = {
        version: SNAPSHOT_VERSION,
        computedAt: Date.now(),
        writerId: this.writerId,
        leaseEpoch: this.lease().epoch,
        topErrors: blocked.clusters.slice(0, MAX_ERROR_CLUSTERS),
        errorClustersBound: {
          included: Math.min(blocked.clusters.length, MAX_ERROR_CLUSTERS),
          total: blocked.clusters.length,
        },
        parkedTenants: parked.tenants,
        parkedTenantsBound: {
          included: parked.tenants.length,
          total: parked.total,
        },
        pipelineTree: OpsDashboardViewService.buildPipelineTree({
          queues,
          seedKeys: treeSeedKeys,
        }),
        phases: this.window.currentPhases,
        jobNameMetrics: this.window.currentJobNameMetrics,
        latencyWindows,
      };

      // Only adopt the artifact the fence ACCEPTED. A rejected write means the lease
      // turned over mid-scan, so this payload was never published; keeping it would
      // have `tryGetLatestDetail()` report a detail artifact no reader can see. Leaving
      // `lastDetailAt` alone is deliberate too — a pod that regains the lease should
      // rescan rather than sit out a cadence it never completed.
      const published = await snapshots.writeDetail({
        snapshot: detail,
        leaseToken,
      });
      if (!published) {
        return;
      }

      this.latestDetail = detail;
      this.lastDetailAt = Date.now();
    } catch (err) {
      logger.warn({ error: err }, "Failed to publish detail ops snapshot");
      // Back off a full cycle rather than retrying every 2s into a Redis
      // that is already struggling — the failure and the cause usually share
      // a root.
      this.lastDetailAt = Date.now();
    }
  }

  /** The detail artifact this writer most recently produced, if any. */
  tryGetLatestDetail(): DetailSnapshot | null {
    return this.latestDetail;
  }
}
