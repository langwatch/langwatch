/**
 * The fleet's queue metrics: one pod holds the lease and scans, folding each cycle into its window
 * and publishing what every other pod reads. Sampling, the dashboard view and the two published
 * artifacts each have their own service; this owns the lease, the schedule and the cycle's order.
 */

import * as os from "node:os";
import { createLogger } from "@langwatch/observability";
import type {
  DashboardData,
  DetailSnapshot,
  OpsSnapshotService,
  PipelineNode,
  QueueInfo,
  RedisInfo,
} from "@langwatch/ops-contract";
import { computeEngineCpuPercent } from "../rules/ops-redis-engine-cpu.rules.ts";
import type { OpsQueueMetricsSourcePort } from "../ports/ops-queue-metrics-source.port.ts";
import type { OpsMetricsRepository } from "../repositories/observe/ops-metrics.repository.ts";
import { totalInFlight as computeTotalInFlight } from "../rules/ops-in-flight.rules.ts";
import { OpsDashboardViewService } from "./ops-dashboard-view.service.ts";
import { OpsMetricsPublicationService } from "./ops-metrics-publication.service.ts";
import { OpsMetricsSamplingService } from "./ops-metrics-sampling.service.ts";
import { nowInstant } from "@langwatch/time";
import {
  METRICS_COLLECT_INTERVAL_MS,
  OpsMetricsWindowService,
  THROUGHPUT_BUFFER_SIZE,
} from "./ops-metrics-window.service.ts";

const logger = createLogger("langwatch:ops:metrics-collector");

const PENDING_RECONCILE_INTERVAL_MS = 60_000;
const QUEUE_DISCOVERY_INTERVAL_MS = 10_000;

/** How long a known pipeline path stays listed after it was last seen. */
const KNOWN_PIPELINE_PATH_TTL_MS = 24 * 60 * 60 * 1000;

export class OpsMetricsCollectorService {
  private metrics: OpsMetricsRepository;
  private groupQueueNames: string[] = [];
  // Previous Redis CPU snapshot used to derive an engine-CPU percent between
  // successive collect() cycles. Null until the first sample lands. We sample
  // the *main-thread* counters specifically because Redis processes commands
  // on a single thread — that's the metric that pegs at 100% during
  // saturation (CloudWatch's `EngineCPUUtilization`).
  private collectInterval: ReturnType<typeof setInterval> | null = null;
  private discoveryInterval: ReturnType<typeof setInterval> | null = null;
  private reconcileInterval: ReturnType<typeof setInterval> | null = null;
  /**
   * Last drift figure read back from the shared publication, not the one this
   * instance measured. See {@link reconcilePending}.
   */
  private isCollecting = false;

  private readonly ops: OpsQueueMetricsSourcePort;
  private snapshots: OpsSnapshotService | null;
  /** Identity of this writer in the lease and in every artifact it stamps. */
  private readonly writerId: string;
  private leaseEpoch = 0;
  private holdsLease = false;
  /** Token of the CURRENT acquisition; writes are fenced on it, not on the id. */
  private leaseToken: string | null = null;
  private lastDetailAt = 0;
  private detailInFlight = false;
  /** Latest scan, held so the detail cycle can derive structure without rescanning. */
  private latestDetail: DetailSnapshot | null = null;

  /** The one collector this process runs, once `getSingleton` has built it. */
  /** The one collector this process runs, once `getSingleton` has built it. */
  private static singleton: OpsMetricsCollectorService | null = null;

  private readonly window = OpsMetricsWindowService.create();
  private readonly sampling: OpsMetricsSamplingService;
  private readonly publication: OpsMetricsPublicationService;

  static create(params: {
    metrics: OpsMetricsRepository;
    ops: OpsQueueMetricsSourcePort;
    snapshots?: OpsSnapshotService | null;
    writerId?: string;
  }): OpsMetricsCollectorService {
    return new OpsMetricsCollectorService(params);
  }

  /** The process-wide collector, started on first call. */
  static getSingleton(params: {
    metrics: OpsMetricsRepository;
    ops: OpsQueueMetricsSourcePort;
    snapshots?: OpsSnapshotService | null;
  }): OpsMetricsCollectorService {
    if (!OpsMetricsCollectorService.singleton) {
      const collector = OpsMetricsCollectorService.create(params);
      OpsMetricsCollectorService.singleton = collector;
      collector.start().catch((err) => {
        logger.error({ error: err }, "Failed to start ops metrics collector");
      });
    }

    return OpsMetricsCollectorService.singleton;
  }

  /** Which phase a job type belongs to, as the dashboard groups them. */
  static mapJobTypeToPhase(
    jobType: string | null | undefined,
  ): "commands" | "projections" | "reactions" {
    return OpsMetricsSamplingService.mapJobTypeToPhase(jobType);
  }

  /** The pipeline tree the sidebar walks, for a set of scanned queues. */
  static buildPipelineTree(params: { queues: QueueInfo[]; seedKeys?: string[] }): PipelineNode[] {
    return OpsDashboardViewService.buildPipelineTree(params);
  }

  private constructor(params: {
    metrics: OpsMetricsRepository;
    ops: OpsQueueMetricsSourcePort;
    snapshots?: OpsSnapshotService | null;
    writerId?: string;
  }) {
    this.metrics = params.metrics;
    this.ops = params.ops;
    this.snapshots = params.snapshots ?? null;
    this.writerId = params.writerId ?? `${os.hostname()}:${process.pid}`;
    this.sampling = OpsMetricsSamplingService.create({ metrics: this.metrics });
    this.publication = OpsMetricsPublicationService.create({
      ops: this.ops,
      sampling: this.sampling,
      window: this.window,
      writerId: this.writerId,
      queueNames: () => this.groupQueueNames,
      lease: () => ({ token: this.leaseToken, epoch: this.leaseEpoch }),
      snapshots: this.snapshots,
    });
  }

  /** True while this pod is the fleet's writer. Exposed for tests and logs. */
  isWriter(): boolean {
    return this.holdsLease;
  }

  async start(): Promise<void> {
    await this.window.restore(this.metrics);
    await this.discoverQueues();
    // Kick off the first collect without blocking start(); the interval below
    // will keep collecting on schedule. Errors are caught inside collect().
    void this.collect();
    this.collectInterval = setInterval(() => this.collect(), METRICS_COLLECT_INTERVAL_MS);
    this.discoveryInterval = setInterval(() => this.discoverQueues(), QUEUE_DISCOVERY_INTERVAL_MS);
    this.reconcileInterval = setInterval(
      () => this.reconcilePending(),
      PENDING_RECONCILE_INTERVAL_MS,
    );
    void this.reconcilePending();
    // No broadcast here by design (ADR-090): the writer publishes to Redis and
    // `OpsSnapshotService` is what fans out to each pod's subscribers. A writer
    // that also broadcast would serve its own pod a different payload from
    // every other pod — the exact divergence this design removes.
  }

  /**
   * Awaits the lease release. The caller is a shutdown hook racing a process exit and a Redis
   * disconnect, so a fire-and-forget release here is the same as no release at all: the connection
   * closes first and the fleet waits out the full lease TTL for a writer it could have had immediately.
   */
  async stop(): Promise<void> {
    if (this.collectInterval) {
      clearInterval(this.collectInterval);
      this.collectInterval = null;
    }

    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }

    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval);
      this.reconcileInterval = null;
    }

    // Hand the lease back rather than letting it lapse: a clean shutdown that
    // waits out the TTL leaves the whole fleet without a writer for up to the
    // lease window, which is exactly the rolling-deploy case.
    if (this.snapshots && this.holdsLease) {
      this.holdsLease = false;
      this.leaseToken = null;
      try {
        await this.snapshots.releaseLease();
      } catch (err) {
        logger.warn({ error: err }, "Failed to release ops snapshot lease");
      }
    }
  }

  async discoverQueues(): Promise<void> {
    try {
      this.groupQueueNames = await this.ops.discoverQueueNames();
    } catch (err) {
      logger.warn({ error: err }, "Queue discovery failed, keeping existing names");
    }
  }

  private async reconcilePending(): Promise<void> {
    try {
      let measuredDrift = 0;
      let measuredAny = false;
      for (const queueName of this.groupQueueNames) {
        const result = await this.ops.tryReconcileQueuePending({ queueName });
        if (result) {
          measuredDrift += Math.abs(result.drift);
          measuredAny = true;
        }
      }

      // Read back what every instance published rather than keeping what this one measured. The
      // reconcile is single-flighted, so an instance that won no marker measured nothing and
      // would otherwise report 0 drift for a queue that has plenty, and an instance that won
      // some of the queues would report a partial total. Reading the shared figures is what
      // makes every instance agree, and agree on the whole.
      this.window.latestPendingDrift = await this.ops.readQueuePendingDrift({
        queueNames: this.groupQueueNames,
      });

      if (measuredAny && measuredDrift !== 0) {
        logger.info(
          { pendingDrift: measuredDrift },
          "Reconciled GroupQueue pending counter to ground truth",
        );
      }
    } catch (err) {
      logger.warn({ error: err }, "Failed to reconcile pending counter");
    }
  }

  /** This pod's view of the dashboard. */
  getDashboardData(): DashboardData {
    return this.publication.dashboardData();
  }

  /** The detail artifact this writer most recently produced, if any. */
  tryGetLatestDetail(): DetailSnapshot | null {
    return this.publication.tryGetLatestDetail();
  }

  /**
   * One cycle: win the lease or stand down, scan, fold the deltas into the window, then publish.
   * A pod that does not hold the lease pays for nothing — the early return is the whole saving,
   * since otherwise every pod would still scan and merely skip the write.
   */
  async collect(): Promise<void> {
    if (this.isCollecting) {
      return;
    }

    this.isCollecting = true;
    try {
      if (!(await this.claimLease())) {
        return;
      }

      const [queues, redisInfo] = await Promise.all([
        this.ops.scanQueues({ queueNames: this.groupQueueNames }),
        this.sampling.getRedisInfo(),
      ]);
      this.window.latestQueues = queues;
      this.window.latestRedisInfo = redisInfo;
      this.recordRedisCpu(redisInfo);
      this.window.currentPausedKeys = await this.metrics.readPausedJobKeys({
        queueNames: this.groupQueueNames,
      });
      await this.recordKnownPipelinePaths(queues);
      await this.recordCycleRates(queues);
      this.recordProcessCpu();
      this.window.pruneStaleCounters(this.groupQueueNames);
      this.window.persist(this.metrics).catch((err) => {
        logger.warn({ error: err }, "Failed to persist metrics state");
      });

      if (this.snapshots) {
        await this.publication.publishLive();
        this.publication.maybePublishDetail(queues);
      }
    } catch (err) {
      logger.warn({ error: err }, "Metrics collection failed, retrying next interval");
    } finally {
      this.isCollecting = false;
    }
  }

  /**
   * Whether this pod may scan at all. Taking over reloads the fleet's accumulators BEFORE the scan:
   * peaks and history are accumulated, not derived, and publishing a losing pod's frozen copy would
   * blank the chart for every viewer and then persist that over the fleet's real record.
   */
  private async claimLease(): Promise<boolean> {
    if (!this.snapshots) {
      return true;
    }

    const lease = await this.snapshots.acquireOrRenewLease({ writerId: this.writerId });
    if (!lease.isHeld) {
      this.holdsLease = false;
      this.leaseToken = null;

      return false;
    }

    if (!this.holdsLease) {
      await this.window.restore(this.metrics);
    }

    this.holdsLease = true;
    this.leaseEpoch = lease.epoch;
    this.leaseToken = lease.token;

    return true;
  }

  /** Redis reports CPU as cumulative seconds; a percent needs the previous sample. */
  private recordRedisCpu(redisInfo: RedisInfo): void {
    const sampledAt = nowInstant().epochMilliseconds;
    this.window.currentRedisEngineCpuPercent = computeEngineCpuPercent({
      prev: this.window.prevRedisCpu,
      nextUserSec: redisInfo.usedCpuUserMainThreadSeconds,
      nextSysSec: redisInfo.usedCpuSysMainThreadSeconds,
      nextSampledAt: sampledAt,
    });
    this.window.prevRedisCpu = {
      userSec: redisInfo.usedCpuUserMainThreadSeconds,
      sysSec: redisInfo.usedCpuSysMainThreadSeconds,
      sampledAt,
    };
  }

  /** Every pipeline path seen this cycle, so a path with no live group still lists. */
  private async recordKnownPipelinePaths(queues: QueueInfo[]): Promise<void> {
    const discoveredPaths = new Set<string>();
    for (const queue of queues) {
      for (const group of queue.groups) {
        const pipeline = group.pipelineName ?? queue.displayName;
        discoveredPaths.add(
          `${pipeline}/${group.jobType ?? "default"}/${group.jobName ?? "default"}`,
        );
      }
    }

    if (discoveredPaths.size > 0) {
      const timestamp = nowInstant().epochMilliseconds;
      await this.metrics.recordKnownPipelinePaths({
        paths: [...discoveredPaths],
        at: timestamp,
        dropBefore: timestamp - KNOWN_PIPELINE_PATH_TTL_MS,
      });
    }

    this.window.knownPipelinePaths = await this.metrics.readKnownPipelinePaths();
  }

  /**
   * The rates this cycle measured, and the history point they produce. Parked groups count toward
   * in-flight (see ../rules/ops-in-flight.rules), without which the derived ingestion rate is wrong.
   */
  private async recordCycleRates(queues: QueueInfo[]): Promise<void> {
    let totalPending = 0;
    let totalBlockedCount = 0;
    let totalParkedCount = 0;
    for (const queue of queues) {
      totalPending += queue.totalPendingJobs;
      totalBlockedCount += queue.blockedGroupCount;
      totalParkedCount += queue.parkedGroupCount;
    }

    const totalInFlight = computeTotalInFlight({ queues });
    const now = nowInstant().epochMilliseconds;
    const elapsed = (now - this.window.lastTimestamp) / 1000;
    const { newCompleted, newFailed } = await this.sampling.computeJobMetrics({
      window: this.window,
      queueNames: this.groupQueueNames,
      queues,
      elapsed: this.window.hasBaseline ? elapsed : 0,
    });

    this.window.latestTotalCompleted += newCompleted;
    this.window.latestTotalFailed += newFailed;
    if (this.window.hasBaseline && elapsed > 0) {
      this.window.currentCompletedPerSec = Math.round((newCompleted / elapsed) * 100) / 100;
      this.window.currentFailedPerSec = Math.round((newFailed / elapsed) * 100) / 100;
      const ingestedDelta =
        totalInFlight - this.window.lastTotalInFlight + newCompleted + newFailed;
      this.window.currentIngestedPerSec =
        Math.round((Math.max(0, ingestedDelta) / elapsed) * 100) / 100;
      this.window.peakCompletedPerSec = Math.max(
        this.window.peakCompletedPerSec,
        this.window.currentCompletedPerSec,
      );
      this.window.peakFailedPerSec = Math.max(
        this.window.peakFailedPerSec,
        this.window.currentFailedPerSec,
      );
      this.window.peakIngestedPerSec = Math.max(
        this.window.peakIngestedPerSec,
        this.window.currentIngestedPerSec,
      );
    }

    this.window.lastTotalInFlight = totalInFlight;
    this.window.lastTimestamp = now;
    this.window.hasBaseline = true;
    this.window.throughputBuffer.push({
      timestamp: now,
      ingestedPerSec: this.window.currentIngestedPerSec,
      completedPerSec: this.window.currentCompletedPerSec,
      failedPerSec: this.window.currentFailedPerSec,
      pendingCount: totalPending,
      blockedCount: totalBlockedCount,
      parkedCount: totalParkedCount,
    });
    if (this.window.throughputBuffer.length > THROUGHPUT_BUFFER_SIZE) {
      this.window.throughputBuffer.shift();
    }
  }

  /** This process's own CPU share since the last cycle. */
  private recordProcessCpu(): void {
    const now = nowInstant().epochMilliseconds;
    const cpuNow = process.cpuUsage(this.window.lastCpuUsage);
    const cpuElapsed = now - this.window.lastCpuTime;
    if (cpuElapsed > 0) {
      this.window.currentCpuPercent = ((cpuNow.user + cpuNow.system) / 1000 / cpuElapsed) * 100;
    }

    this.window.lastCpuUsage = process.cpuUsage();
    this.window.lastCpuTime = now;
  }
}
