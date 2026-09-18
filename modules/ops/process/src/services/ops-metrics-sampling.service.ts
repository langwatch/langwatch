/**
 * What one cycle reads and derives: the per-queue and per-job-name throughput since the last cycle,
 * the phase rollup, the latency windows the detail cycle reports, and Redis's own numbers. Every
 * derived figure lands in the window it was handed, which is what the next cycle measures against.
 */

import { createLogger } from "@langwatch/observability";
import { mergeHistogramCounts, windowPercentiles } from "@langwatch/ops-contract";
import type {
  DashboardData,
  JobNameMetrics,
  LatencyWindows,
  QueueInfo,
  RedisInfo,
} from "@langwatch/ops-contract";
import type { OpsMetricsRepository } from "../repositories/observe/ops-metrics.repository.ts";
import { JOB_NAME_COUNTER_PREFIX, OpsMetricsWindowService } from "./ops-metrics-window.service.ts";
import { nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:ops:metrics-sampling");

export class OpsMetricsSamplingService {
  private constructor(private readonly metrics: OpsMetricsRepository) {}

  static create({ metrics }: { metrics: OpsMetricsRepository }): OpsMetricsSamplingService {
    return new OpsMetricsSamplingService(metrics);
  }

  static normalizeJobType(jobType: string): string {
    const lower = jobType.toLowerCase();
    if (lower === "projection") {
      return "fold";
    }

    if (lower === "handler") {
      return "map";
    }

    if (lower === "stateprojection") {
      return "state";
    }

    if (lower === "reaction") {
      return "reactor";
    }

    return jobType;
  }

  static mapJobTypeToPhase(
    jobType: string | null | undefined,
  ): "commands" | "projections" | "reactions" {
    if (!jobType) {
      return "commands";
    }

    const lower = jobType.toLowerCase();
    if (lower === "projection" || lower === "handler" || lower === "stateprojection") {
      return "projections";
    }

    if (lower === "reactor" || lower === "reaction") {
      return "reactions";
    }

    return "commands";
  }

  async computeLatencyWindows(queueNames: string[]): Promise<LatencyWindows> {
    try {
      return await this.readLatencyWindows(queueNames);
    } catch (err) {
      // Fail soft: the rest of the detail artifact (blocked clusters, parked
      // tenants) must not be lost to a histogram read hiccup. All-null
      // windows render as "nothing to report yet".
      logger.warn({ error: err }, "Failed to compute latency windows");

      return { hour: null, day: null, week: null, allTime: null };
    }
  }

  async readLatencyWindows(queueNames: string[]): Promise<LatencyWindows> {
    const { minute, hourByQueue, allTime } = await this.metrics.readLatencyHistograms({
      queueNames: queueNames,
      nowMs: nowInstant().epochMilliseconds,
    });
    // Hour buckets come back newest-first per queue; the first 24 of each
    // queue's 168 belong to the day window as well as the week's.
    const dayHashes = hourByQueue.flatMap((hours) => hours.slice(0, 24));

    return {
      hour: windowPercentiles(mergeHistogramCounts(minute)),
      day: windowPercentiles(mergeHistogramCounts(dayHashes)),
      week: windowPercentiles(mergeHistogramCounts(hourByQueue.flat())),
      allTime: windowPercentiles(mergeHistogramCounts(allTime)),
    };
  }

  aggregatePhaseCounts(queues: QueueInfo[]): DashboardData["phases"] {
    const phases = OpsMetricsWindowService.emptyPhases();
    for (const q of queues) {
      for (const g of q.groups) {
        const phase = OpsMetricsSamplingService.mapJobTypeToPhase(g.jobType);
        phases[phase].pending += g.pendingJobs;
        phases[phase].active += g.hasActiveJob ? 1 : 0;
      }
    }

    return phases;
  }

  buildJobNameCounts(queues: QueueInfo[]): Map<
    string,
    {
      pending: number;
      active: number;
      phase: "commands" | "projections" | "reactions";
      pipelineName: string;
    }
  > {
    const map = new Map<
      string,
      {
        pending: number;
        active: number;
        phase: "commands" | "projections" | "reactions";
        pipelineName: string;
      }
    >();
    for (const q of queues) {
      for (const g of q.groups) {
        const jobName = g.jobName ?? "unknown";
        const pipelineName = g.pipelineName ?? q.displayName;
        const phase = OpsMetricsSamplingService.mapJobTypeToPhase(g.jobType);
        const key = `${pipelineName}::${jobName}`;
        const existing = map.get(key);
        if (existing) {
          existing.pending += g.pendingJobs;
          existing.active += g.hasActiveJob ? 1 : 0;
        } else {
          map.set(key, {
            pending: g.pendingJobs,
            active: g.hasActiveJob ? 1 : 0,
            phase,
            pipelineName,
          });
        }
      }
    }

    return map;
  }

  /** Flattens a pipeline's per-queue `smembers` results into the set of paused job keys. */
  async computeJobMetrics({
    window,
    queueNames,
    queues,
    elapsed,
  }: {
    window: OpsMetricsWindowService;
    queueNames: string[];
    queues: QueueInfo[];
    elapsed: number;
  }): Promise<{ newCompleted: number; newFailed: number }> {
    const phases = this.aggregatePhaseCounts(queues);

    let newCompleted = 0;
    let newFailed = 0;

    const totals = await this.metrics.readQueueTotals({ queueNames: queueNames });
    for (let i = 0; i < queueNames.length; i++) {
      const name = queueNames[i]!;
      const { completed: completedTotal, failed: failedTotal } = totals[i]!;

      const prevC = window.prevCompleted.get(name) ?? 0;
      const prevF = window.prevFailed.get(name) ?? 0;

      if (window.prevCompleted.has(name)) {
        newCompleted += Math.max(0, completedTotal - prevC);
        newFailed += Math.max(0, failedTotal - prevF);
      }

      window.prevCompleted.set(name, completedTotal);
      window.prevFailed.set(name, failedTotal);
    }

    const latencies: number[] = [];
    if (newCompleted > 0 || !window.hasBaseline) {
      latencies.push(...(await this.metrics.readLatencySamplesMs({ queueNames: queueNames })));
    }

    if (latencies.length > 0) {
      latencies.sort((a, b) => a - b);
      const p50Idx = Math.floor(latencies.length * 0.5);
      const p99Idx = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.99));
      window.currentLatencyP50Ms = latencies[p50Idx]!;
      window.currentLatencyP99Ms = latencies[p99Idx]!;
      window.peakLatencyP50Ms = Math.max(window.peakLatencyP50Ms, window.currentLatencyP50Ms);
      window.peakLatencyP99Ms = Math.max(window.peakLatencyP99Ms, window.currentLatencyP99Ms);
    }

    for (const key of ["commands", "projections", "reactions"] as const) {
      const pp = window.peakPhases[key]!;
      phases[key].peakCompletedPerSec = pp.completedPerSec;
      phases[key].peakFailedPerSec = pp.failedPerSec;
      phases[key].peakLatencyP50Ms = pp.latencyP50Ms;
      phases[key].peakLatencyP99Ms = pp.latencyP99Ms;
    }

    window.currentPhases = phases;

    window.currentJobNameMetrics = await this.computeJobNameThroughput({
      window,
      queueNames,
      queues,
      elapsed,
    });

    return { newCompleted, newFailed };
  }

  async computeJobNameThroughput({
    window,
    queueNames,
    queues,
    elapsed,
  }: {
    window: OpsMetricsWindowService;
    queueNames: string[];
    queues: QueueInfo[];
    elapsed: number;
  }): Promise<JobNameMetrics[]> {
    const jobNameCounts = this.buildJobNameCounts(queues);

    const uniqueJobNames = new Set<string>();
    for (const [compositeKey] of jobNameCounts) {
      uniqueJobNames.add(compositeKey.split("::")[1] ?? compositeKey);
    }

    const jobNameTotals = await this.metrics.readJobNameTotals({
      queueNames: queueNames,
      jobNames: [...uniqueJobNames],
    });

    const metrics: JobNameMetrics[] = [];
    for (const [compositeKey, counts] of jobNameCounts) {
      const jobName = compositeKey.split("::")[1] ?? compositeKey;

      const totals = jobNameTotals.get(jobName) ?? {
        completed: 0,
        failed: 0,
      };
      const prevKey = `${JOB_NAME_COUNTER_PREFIX}${compositeKey}`;
      const prevC = window.prevCompleted.get(prevKey) ?? 0;
      const prevF = window.prevFailed.get(prevKey) ?? 0;

      let completedPerSec = 0;
      let failedPerSec = 0;
      if (window.prevCompleted.has(prevKey) && elapsed > 0) {
        completedPerSec = Math.max(0, totals.completed - prevC) / elapsed;
        failedPerSec = Math.max(0, totals.failed - prevF) / elapsed;
      }

      window.prevCompleted.set(prevKey, totals.completed);
      window.prevFailed.set(prevKey, totals.failed);

      const peak = window.peakJobNames.get(compositeKey) ?? {
        completedPerSec: 0,
        failedPerSec: 0,
        latencyP50Ms: 0,
        latencyP99Ms: 0,
      };
      peak.completedPerSec = Math.max(peak.completedPerSec, completedPerSec);
      peak.failedPerSec = Math.max(peak.failedPerSec, failedPerSec);
      window.peakJobNames.set(compositeKey, peak);

      metrics.push({
        jobName,
        pipelineName: counts.pipelineName,
        phase: counts.phase,
        pending: counts.pending,
        active: counts.active,
        completedPerSec,
        failedPerSec,
        latencyP50Ms: 0,
        latencyP99Ms: 0,
        peakCompletedPerSec: peak.completedPerSec,
        peakFailedPerSec: peak.failedPerSec,
        peakLatencyP50Ms: peak.latencyP50Ms,
        peakLatencyP99Ms: peak.latencyP99Ms,
      });
    }

    return metrics;
  }

  /**
   * Fold the fleet's persisted accumulators into this instance's.
   */
  async getRedisInfo(): Promise<RedisInfo> {
    const info = await this.metrics.readServerInfo();
    const get = (key: string): string => {
      const match = info.match(new RegExp(`${key}:(.+)`));

      return match?.[1]?.trim() ?? "?";
    };

    return {
      usedMemoryHuman: get("used_memory_human"),
      peakMemoryHuman: get("used_memory_peak_human"),
      usedMemoryBytes: parseInt(get("used_memory"), 10) || 0,
      peakMemoryBytes: parseInt(get("used_memory_peak"), 10) || 0,
      maxMemoryBytes: parseInt(get("maxmemory"), 10) || 0,
      connectedClients: parseInt(get("connected_clients"), 10) || 0,
      usedCpuUserMainThreadSeconds: parseFloat(get("used_cpu_user_main_thread")) || 0,
      usedCpuSysMainThreadSeconds: parseFloat(get("used_cpu_sys_main_thread")) || 0,
    };
  }
}
