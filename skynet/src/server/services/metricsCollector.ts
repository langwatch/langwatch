import * as os from "node:os";
import type IORedis from "ioredis";
import type { DashboardData, PipelineNode, ThroughputPoint, QueueInfo, QueueSummaryInfo, JobNameMetrics } from "../../shared/types.ts";
import { THROUGHPUT_BUFFER_SIZE, METRICS_COLLECT_INTERVAL_MS, REDIS_STATE_TTL_SECONDS, AUTO_PAUSE_ERROR_THRESHOLD_PER_SEC, AUTO_PAUSE_CONSECUTIVE_INTERVALS } from "../../shared/constants.ts";

import { scanGroupQueues } from "./groupQueueScanner.ts";
import { getRedisInfo, type RedisInfo } from "./redis.ts";
import { normalizeErrorMessage } from "../../shared/normalizeErrorMessage.ts";

const REDIS_STATE_KEY = "skynet:state";
const KNOWN_PIPELINES_KEY = "skynet:known-pipelines";
/** Prefix for per-job-name keys in prevCompleted/prevFailed maps to avoid collisions with queue-level keys */
const JOB_NAME_COUNTER_PREFIX = "jn:";

interface PersistedMetricsState {
  version: 3;
  savedAt: number;
  peakCompletedPerSec: number;
  peakFailedPerSec: number;
  peakIngestedPerSec: number;
  peakLatencyP50Ms: number;
  peakLatencyP99Ms: number;
  peakPhases: Record<string, { completedPerSec: number; failedPerSec: number; latencyP50Ms: number; latencyP99Ms: number }>;
  peakJobNames: Array<[string, { completedPerSec: number; failedPerSec: number; latencyP50Ms: number; latencyP99Ms: number }]>;
  throughputBuffer: ThroughputPoint[];
  latestTotalCompleted: number;
  latestTotalFailed: number;
}

export class MetricsCollector {
  private redis: IORedis;
  private groupQueueNames: string[];
  private throughputBuffer: ThroughputPoint[] = [];
  private lastTotalInFlight = 0;
  private lastTimestamp = Date.now();
  private hasBaseline = false;
  private currentIngestedPerSec = 0;
  private currentCompletedPerSec = 0;
  private currentFailedPerSec = 0;
  private currentPhases: DashboardData["phases"] = emptyPhases();
  private currentLatencyP50Ms = 0;
  private currentLatencyP99Ms = 0;
  private peakCompletedPerSec = 0;
  private peakFailedPerSec = 0;
  private peakIngestedPerSec = 0;
  private peakLatencyP50Ms = 0;
  private peakLatencyP99Ms = 0;
  private peakPhases: Record<string, { completedPerSec: number; failedPerSec: number; latencyP50Ms: number; latencyP99Ms: number }> = {
    commands: { completedPerSec: 0, failedPerSec: 0, latencyP50Ms: 0, latencyP99Ms: 0 },
    projections: { completedPerSec: 0, failedPerSec: 0, latencyP50Ms: 0, latencyP99Ms: 0 },
    reactions: { completedPerSec: 0, failedPerSec: 0, latencyP50Ms: 0, latencyP99Ms: 0 },
  };
  private latestTotalCompleted = 0;
  private latestTotalFailed = 0;
  private latestQueues: QueueInfo[] = [];
  private latestRedisInfo: RedisInfo = {
    usedMemoryHuman: "?",
    peakMemoryHuman: "?",
    usedMemoryBytes: 0,
    peakMemoryBytes: 0,
    maxMemoryBytes: 0,
    connectedClients: 0,
  };
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastCpuUsage = process.cpuUsage();
  private lastCpuTime = Date.now();
  private currentCpuPercent = 0;
  private peakJobNames = new Map<string, { completedPerSec: number; failedPerSec: number; latencyP50Ms: number; latencyP99Ms: number }>();
  private currentJobNameMetrics: JobNameMetrics[] = [];
  private currentPausedKeys: string[] = [];
  private knownPipelinePaths: string[] = [];
  private isCollecting = false;
  /** Previous counter values for delta computation */
  private prevCompleted = new Map<string, number>();
  private prevFailed = new Map<string, number>();
  private autoPauseCounters = new Map<string, number>(); // pipelineName -> consecutive intervals above threshold
  private autoPausedPipelines = new Set<string>();

  constructor(redis: IORedis, groupQueueNames: string[]) {
    this.redis = redis;
    this.groupQueueNames = groupQueueNames;
  }

  async start(): Promise<void> {
    await this.restoreState();
    this.collect();
    this.interval = setInterval(() => this.collect(), METRICS_COLLECT_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  updateGroupQueueNames(names: string[]): void {
    this.groupQueueNames = names;
  }

  getLatestQueues(): QueueInfo[] {
    return this.latestQueues;
  }

  getDashboardData(): DashboardData {
    const fullQueues = this.latestQueues;
    const redisInfo = this.latestRedisInfo;

    let totalGroups = 0;
    let blockedGroups = 0;
    let totalPendingJobs = 0;

    for (const q of fullQueues) {
      totalGroups += q.groups.length;
      blockedGroups += q.blockedGroupCount;
      totalPendingJobs += q.totalPendingJobs;
    }

    const treeSeedKeys = [...new Set([...this.currentPausedKeys, ...this.knownPipelinePaths])];
    const pipelineTree = buildPipelineTree({ queues: fullQueues, seedKeys: treeSeedKeys });

    // Aggregate top errors from cached groups (approximate - only from top 200)
    const errorMap = new Map<string, { normalizedMessage: string; sampleMessage: string; sampleStack: string | null; count: number; pipelineName: string | null; sampleGroupIds: string[] }>();
    for (const q of fullQueues) {
      for (const g of q.groups) {
        if (!g.isBlocked || !g.errorMessage) continue;
        const normalized = normalizeErrorMessage(g.errorMessage);
        const key = `${g.pipelineName ?? ""}::${normalized}`;
        const existing = errorMap.get(key);
        if (existing) {
          existing.count++;
          if (existing.sampleGroupIds.length < 5) existing.sampleGroupIds.push(g.groupId);
        } else {
          errorMap.set(key, {
            normalizedMessage: normalized,
            sampleMessage: g.errorMessage,
            sampleStack: g.errorStack,
            count: 1,
            pipelineName: g.pipelineName,
            sampleGroupIds: [g.groupId],
          });
        }
      }
    }
    const topErrors = Array.from(errorMap.values()).sort((a, b) => b.count - a.count).slice(0, 10);

    // Strip groups from queues — individual group data is served via /api/groups on demand.
    // This avoids serializing potentially millions of GroupInfo objects in every SSE broadcast.
    const queues: QueueSummaryInfo[] = fullQueues.map(({ groups: _groups, ...summary }) => summary);

    const mem = process.memoryUsage();

    return {
      totalGroups,
      blockedGroups,
      totalPendingJobs,
      throughputIngestedPerSec: this.currentIngestedPerSec,
      totalCompleted: this.latestTotalCompleted,
      totalFailed: this.latestTotalFailed,
      completedPerSec: this.currentCompletedPerSec,
      failedPerSec: this.currentFailedPerSec,
      peakCompletedPerSec: this.peakCompletedPerSec,
      peakFailedPerSec: this.peakFailedPerSec,
      peakIngestedPerSec: this.peakIngestedPerSec,
      redisMemoryUsed: redisInfo.usedMemoryHuman,
      redisMemoryPeak: redisInfo.peakMemoryHuman,
      redisMemoryUsedBytes: redisInfo.usedMemoryBytes,
      redisMemoryPeakBytes: redisInfo.peakMemoryBytes,
      redisMemoryMaxBytes: redisInfo.maxMemoryBytes,
      redisConnectedClients: redisInfo.connectedClients,
      processCpuPercent: Math.round(this.currentCpuPercent * 10) / 10,
      processMemoryUsedMb: Math.round(mem.rss / 1024 / 1024),
      processMemoryTotalMb: Math.round(os.totalmem() / 1024 / 1024),
      throughputHistory: [...this.throughputBuffer],
      pipelineTree,
      queues,
      latencyP50Ms: this.currentLatencyP50Ms,
      latencyP99Ms: this.currentLatencyP99Ms,
      peakLatencyP50Ms: this.peakLatencyP50Ms,
      peakLatencyP99Ms: this.peakLatencyP99Ms,
      phases: this.currentPhases,
      jobNameMetrics: this.currentJobNameMetrics,
      pausedKeys: this.currentPausedKeys,
      topErrors,
    };
  }

  private aggregatePhaseCounts(queues: QueueInfo[]): DashboardData["phases"] {
    const phases = emptyPhases();
    for (const q of queues) {
      for (const g of q.groups) {
        const phase = mapJobTypeToPhase(g.jobType);
        phases[phase].pending += g.pendingJobs;
        phases[phase].active += g.hasActiveJob ? 1 : 0;
      }
    }
    return phases;
  }

  private buildJobNameCounts(queues: QueueInfo[]): Map<string, { pending: number; active: number; phase: "commands" | "projections" | "reactions"; pipelineName: string }> {
    const map = new Map<string, { pending: number; active: number; phase: "commands" | "projections" | "reactions"; pipelineName: string }>();
    for (const q of queues) {
      for (const g of q.groups) {
        const jobName = g.jobName ?? "unknown";
        const pipelineName = g.pipelineName ?? q.displayName;
        const phase = mapJobTypeToPhase(g.jobType);
        const key = `${pipelineName}::${jobName}`;
        const existing = map.get(key);
        if (existing) {
          existing.pending += g.pendingJobs;
          existing.active += g.hasActiveJob ? 1 : 0;
        } else {
          map.set(key, { pending: g.pendingJobs, active: g.hasActiveJob ? 1 : 0, phase, pipelineName });
        }
      }
    }
    return map;
  }

  /**
   * Read atomic counters from the GroupQueue Redis keys and derive throughput
   * via delta between collection intervals. Per-phase pending/active comes
   * from the group scan; per-jobName pending/active likewise.
   */
  private async computeJobMetrics({
    queues,
    elapsed,
  }: {
    queues: QueueInfo[];
    elapsed: number;
  }): Promise<{ newCompleted: number; newFailed: number }> {
    const phases = this.aggregatePhaseCounts(queues);

    // Read stats:completed and stats:failed counters from all group queues
    let newCompleted = 0;
    let newFailed = 0;

    const pipeline = this.redis.pipeline();
    for (const name of this.groupQueueNames) {
      pipeline.get(`${name}:gq:stats:completed`);
      pipeline.get(`${name}:gq:stats:failed`);
    }
    const results = await pipeline.exec();

    if (results) {
      for (let i = 0; i < this.groupQueueNames.length; i++) {
        const name = this.groupQueueNames[i]!;
        const completedTotal = Number(results[i * 2]?.[1] ?? 0);
        const failedTotal = Number(results[i * 2 + 1]?.[1] ?? 0);

        const prevC = this.prevCompleted.get(name) ?? 0;
        const prevF = this.prevFailed.get(name) ?? 0;

        // Only count delta if we have a previous value (not first collection)
        if (this.prevCompleted.has(name)) {
          newCompleted += Math.max(0, completedTotal - prevC);
          newFailed += Math.max(0, failedTotal - prevF);
        }

        this.prevCompleted.set(name, completedTotal);
        this.prevFailed.set(name, failedTotal);
      }
    }

    // Sample recent completed jobs for latency (p50/p99).
    // Read the 50 most recently completed job IDs, then fetch their timestamps.
    const latencies: number[] = [];
    if (newCompleted > 0 || !this.hasBaseline) {
      const latencyPipeline = this.redis.pipeline();
      for (const name of this.groupQueueNames) {
        // ZRANGE with REV + LIMIT gives us newest completed job IDs
        latencyPipeline.zrange(`${name}:completed`, 0, 24, "REV");
      }
      const latencyResults = await latencyPipeline.exec();

      if (latencyResults) {
        const jobIdPipeline = this.redis.pipeline();
        const jobKeys: string[] = [];
        for (let i = 0; i < this.groupQueueNames.length; i++) {
          const jobIds = (latencyResults[i]?.[1] as string[]) ?? [];
          const name = this.groupQueueNames[i]!;
          for (const jobId of jobIds) {
            jobIdPipeline.hmget(`${name}:${jobId}`, "processedOn", "finishedOn");
            jobKeys.push(`${name}:${jobId}`);
          }
        }
        if (jobKeys.length > 0) {
          const jobResults = await jobIdPipeline.exec();
          if (jobResults) {
            for (const [, result] of jobResults) {
              const fields = result as [string | null, string | null];
              const processedOn = fields?.[0] ? Number(fields[0]) : 0;
              const finishedOn = fields?.[1] ? Number(fields[1]) : 0;
              if (processedOn > 0 && finishedOn > processedOn) {
                latencies.push(finishedOn - processedOn);
              }
            }
          }
        }
      }
    }

    if (latencies.length > 0) {
      latencies.sort((a, b) => a - b);
      const p50Idx = Math.floor(latencies.length * 0.5);
      const p99Idx = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.99));
      this.currentLatencyP50Ms = latencies[p50Idx]!;
      this.currentLatencyP99Ms = latencies[p99Idx]!;
      this.peakLatencyP50Ms = Math.max(this.peakLatencyP50Ms, this.currentLatencyP50Ms);
      this.peakLatencyP99Ms = Math.max(this.peakLatencyP99Ms, this.currentLatencyP99Ms);
    }

    // Phase throughput: we don't have per-phase completed/failed from counters,
    // so we leave throughput at the aggregate level. Per-phase pending/active
    // is already populated from the group scan.
    for (const key of ["commands", "projections", "reactions"] as const) {
      const pp = this.peakPhases[key]!;
      phases[key].peakCompletedPerSec = pp.completedPerSec;
      phases[key].peakFailedPerSec = pp.failedPerSec;
      phases[key].peakLatencyP50Ms = pp.latencyP50Ms;
      phases[key].peakLatencyP99Ms = pp.latencyP99Ms;
    }
    this.currentPhases = phases;

    this.currentJobNameMetrics = await this.computeJobNameThroughput(queues, elapsed);

    return { newCompleted, newFailed };
  }

  /** Read per-job-name Redis counters and compute throughput rates. */
  private async computeJobNameThroughput(queues: QueueInfo[], elapsed: number): Promise<JobNameMetrics[]> {
    const jobNameCounts = this.buildJobNameCounts(queues);

    // Deduplicate job names — multiple pipelines may share the same jobName,
    // and Redis counters are keyed by jobName only (not pipeline::jobName).
    const uniqueJobNames = new Set<string>();
    for (const [compositeKey] of jobNameCounts) {
      uniqueJobNames.add(compositeKey.split("::")[1] ?? compositeKey);
    }

    const jobNameCounterPipeline = this.redis.pipeline();
    const dedupedJobNames: string[] = [];
    for (const jobName of uniqueJobNames) {
      for (const queueName of this.groupQueueNames) {
        jobNameCounterPipeline.get(`${queueName}:gq:stats:completed:${jobName}`);
        jobNameCounterPipeline.get(`${queueName}:gq:stats:failed:${jobName}`);
      }
      dedupedJobNames.push(jobName);
    }
    const jobNameCounterResults = dedupedJobNames.length > 0
      ? await jobNameCounterPipeline.exec()
      : [];

    const jobNameTotals = aggregateJobNameCounters({
      jobNameCounterKeys: dedupedJobNames.map((jn) => ({ compositeKey: jn, jobName: jn })),
      jobNameCounterResults: dedupedJobNames.length > 0 ? jobNameCounterResults as Array<[Error | null, unknown]> | null : null,
      queueCount: this.groupQueueNames.length,
    });

    const metrics: JobNameMetrics[] = [];
    for (const [compositeKey, counts] of jobNameCounts) {
      const jobName = compositeKey.split("::")[1] ?? compositeKey;

      const totals = jobNameTotals.get(jobName) ?? { completed: 0, failed: 0 };
      const prevKey = `${JOB_NAME_COUNTER_PREFIX}${compositeKey}`;
      const prevC = this.prevCompleted.get(prevKey) ?? 0;
      const prevF = this.prevFailed.get(prevKey) ?? 0;

      let completedPerSec = 0;
      let failedPerSec = 0;
      if (this.prevCompleted.has(prevKey) && elapsed > 0) {
        completedPerSec = Math.max(0, totals.completed - prevC) / elapsed;
        failedPerSec = Math.max(0, totals.failed - prevF) / elapsed;
      }
      this.prevCompleted.set(prevKey, totals.completed);
      this.prevFailed.set(prevKey, totals.failed);

      const peak = this.peakJobNames.get(compositeKey) ?? { completedPerSec: 0, failedPerSec: 0, latencyP50Ms: 0, latencyP99Ms: 0 };
      peak.completedPerSec = Math.max(peak.completedPerSec, completedPerSec);
      peak.failedPerSec = Math.max(peak.failedPerSec, failedPerSec);
      this.peakJobNames.set(compositeKey, peak);

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

  private async restoreState(): Promise<void> {
    try {
      const raw = await this.redis.get(REDIS_STATE_KEY);
      if (!raw) return;

      const state: PersistedMetricsState = JSON.parse(raw);
      if (state.version !== 3) {
        console.log("Discarding stale metrics state (version mismatch), starting fresh");
        return;
      }

      this.peakCompletedPerSec = state.peakCompletedPerSec;
      this.peakFailedPerSec = state.peakFailedPerSec;
      this.peakIngestedPerSec = state.peakIngestedPerSec;
      this.peakLatencyP50Ms = state.peakLatencyP50Ms;
      this.peakLatencyP99Ms = state.peakLatencyP99Ms;

      for (const [key, value] of Object.entries(state.peakPhases)) {
        this.peakPhases[key] = { ...value };
      }

      for (const [key, value] of state.peakJobNames) {
        this.peakJobNames.set(key, { ...value });
      }

      const cutoff = Date.now() - THROUGHPUT_BUFFER_SIZE * METRICS_COLLECT_INTERVAL_MS;
      this.throughputBuffer = state.throughputBuffer.filter((p) => p.timestamp > cutoff);

      this.latestTotalCompleted = state.latestTotalCompleted;
      this.latestTotalFailed = state.latestTotalFailed;

      console.log(
        `Restored metrics state (saved ${Math.round((Date.now() - state.savedAt) / 1000)}s ago, ` +
        `${this.throughputBuffer.length} throughput points)`
      );
    } catch (err) {
      console.warn("Failed to restore metrics state, starting fresh:", err);
    }
  }

  private async persistState(): Promise<void> {
    const state: PersistedMetricsState = {
      version: 3,
      savedAt: Date.now(),
      peakCompletedPerSec: this.peakCompletedPerSec,
      peakFailedPerSec: this.peakFailedPerSec,
      peakIngestedPerSec: this.peakIngestedPerSec,
      peakLatencyP50Ms: this.peakLatencyP50Ms,
      peakLatencyP99Ms: this.peakLatencyP99Ms,
      peakPhases: this.peakPhases,
      peakJobNames: Array.from(this.peakJobNames.entries()),
      throughputBuffer: this.throughputBuffer,
      latestTotalCompleted: this.latestTotalCompleted,
      latestTotalFailed: this.latestTotalFailed,
    };
    await this.redis.set(REDIS_STATE_KEY, JSON.stringify(state), "EX", REDIS_STATE_TTL_SECONDS);
  }

  private async collect(): Promise<void> {
    if (this.isCollecting) return;
    this.isCollecting = true;
    try {
      const [queues, redisInfo] = await Promise.all([
        scanGroupQueues(this.redis, this.groupQueueNames),
        getRedisInfo(this.redis),
      ]);
      this.latestQueues = queues;
      this.latestRedisInfo = redisInfo;

      // Collect paused keys from all group queues (single pipeline instead of N parallel calls)
      const pausedPipeline = this.redis.pipeline();
      for (const name of this.groupQueueNames) {
        pausedPipeline.smembers(`${name}:gq:paused-jobs`);
      }
      const pausedResults = await pausedPipeline.exec();
      const pausedKeysSet = new Set<string>();
      if (pausedResults) {
        for (const [, result] of pausedResults) {
          if (Array.isArray(result)) {
            for (const key of result) pausedKeysSet.add(key as string);
          }
        }
      }
      this.currentPausedKeys = Array.from(pausedKeysSet);

      // Track known pipeline paths so the tree stays stable.
      // Deduplicate paths before ZADD — many groups share the same pipeline/type/name combo.
      const discoveredPaths = new Set<string>();
      for (const q of queues) {
        for (const g of q.groups) {
          const p = g.pipelineName ?? q.displayName;
          const t = g.jobType ?? "default";
          const n = g.jobName ?? "default";
          discoveredPaths.add(`${p}/${t}/${n}`);
        }
      }
      if (discoveredPaths.size > 0) {
        const timestamp = Date.now();
        const pipeline = this.redis.pipeline();
        for (const path of discoveredPaths) {
          pipeline.zadd(KNOWN_PIPELINES_KEY, timestamp, path);
        }
        // Evict paths not seen in 24h
        pipeline.zremrangebyscore(KNOWN_PIPELINES_KEY, 0, timestamp - 86400 * 1000);
        await pipeline.exec();
      }
      // Cap at 10K paths to prevent unbounded memory growth
      const knownPaths = await this.redis.zrange(KNOWN_PIPELINES_KEY, 0, 9999);
      this.knownPipelinePaths = knownPaths;

      // totalInFlight from the staging layer (pending + active from scanGroupQueues)
      let totalPending = 0;
      let totalActive = 0;
      for (const q of queues) {
        totalPending += q.totalPendingJobs;
        totalActive += q.activeGroupCount;
      }
      const totalInFlight = totalPending + totalActive;

      const now = Date.now();
      const elapsed = (now - this.lastTimestamp) / 1000;

      const { newCompleted, newFailed } = await this.computeJobMetrics({
        queues,
        elapsed: this.hasBaseline ? elapsed : 0,
      });

      this.latestTotalCompleted += newCompleted;
      this.latestTotalFailed += newFailed;

      if (this.hasBaseline && elapsed > 0) {
        this.currentCompletedPerSec = Math.round((newCompleted / elapsed) * 100) / 100;
        this.currentFailedPerSec = Math.round((newFailed / elapsed) * 100) / 100;

        const ingestedDelta = (totalInFlight - this.lastTotalInFlight) + newCompleted + newFailed;
        this.currentIngestedPerSec = Math.round((Math.max(0, ingestedDelta) / elapsed) * 100) / 100;

        this.peakCompletedPerSec = Math.max(this.peakCompletedPerSec, this.currentCompletedPerSec);
        this.peakFailedPerSec = Math.max(this.peakFailedPerSec, this.currentFailedPerSec);
        this.peakIngestedPerSec = Math.max(this.peakIngestedPerSec, this.currentIngestedPerSec);
      }

      this.lastTotalInFlight = totalInFlight;
      this.lastTimestamp = now;
      this.hasBaseline = true;

      let totalBlockedCount = 0;
      for (const q of queues) {
        totalBlockedCount += q.blockedGroupCount;
      }

      this.throughputBuffer.push({
        timestamp: now,
        ingestedPerSec: this.currentIngestedPerSec,
        completedPerSec: this.currentCompletedPerSec,
        failedPerSec: this.currentFailedPerSec,
        pendingCount: totalPending,
        blockedCount: totalBlockedCount,
      });

      if (this.throughputBuffer.length > THROUGHPUT_BUFFER_SIZE) {
        this.throughputBuffer.shift();
      }

      // Track CPU usage
      const cpuNow = process.cpuUsage(this.lastCpuUsage);
      const cpuElapsed = now - this.lastCpuTime;
      if (cpuElapsed > 0) {
        const totalCpuUs = cpuNow.user + cpuNow.system;
        this.currentCpuPercent = (totalCpuUs / 1000 / cpuElapsed) * 100;
      }
      this.lastCpuUsage = process.cpuUsage();
      this.lastCpuTime = now;

      this.persistState().catch((err) => console.warn("Failed to persist metrics state:", err));

      // Auto-pause: check if any pipeline's error rate exceeds threshold
      // We approximate per-pipeline error rate from blocked groups appearing in this interval
      // This is a simple heuristic, not exact per-pipeline failed/s
      // TODO: Implement actual pause action when threshold is exceeded
      if (this.currentFailedPerSec > 0) {
        if (this.currentFailedPerSec >= AUTO_PAUSE_ERROR_THRESHOLD_PER_SEC) {
          const key = "__global__";
          const count = (this.autoPauseCounters.get(key) ?? 0) + 1;
          this.autoPauseCounters.set(key, count);

          if (count >= AUTO_PAUSE_CONSECUTIVE_INTERVALS && !this.autoPausedPipelines.has(key)) {
            this.autoPausedPipelines.add(key);
            console.warn(
              JSON.stringify({
                level: "warn",
                msg: "Auto-pause triggered: error rate exceeded threshold",
                failedPerSec: this.currentFailedPerSec,
                threshold: AUTO_PAUSE_ERROR_THRESHOLD_PER_SEC,
                consecutiveIntervals: count,
              }),
            );
          }
        } else {
          this.autoPauseCounters.delete("__global__");
        }
      }
    } catch (err) {
      console.error("Metrics collection error:", err);
    } finally {
      this.isCollecting = false;
    }
  }
}

export function buildPipelineTree({ queues, seedKeys = [] }: { queues: QueueInfo[]; seedKeys?: string[] }): PipelineNode[] {
  const pipelineMap = new Map<string, Map<string, Map<string, { pending: number; active: number; blocked: number }>>>();

  // Helper to ensure a path exists in the map with at least zero counts
  const ensurePath = (pName: string, jType?: string, jName?: string) => {
    if (!pipelineMap.has(pName)) pipelineMap.set(pName, new Map());
    if (jType) {
      const typeMap = pipelineMap.get(pName)!;
      if (!typeMap.has(jType)) typeMap.set(jType, new Map());
      if (jName) {
        const nameMap = typeMap.get(jType)!;
        if (!nameMap.has(jName)) nameMap.set(jName, { pending: 0, active: 0, blocked: 0 });
      }
    }
  };

  // Seed the tree from seed keys so they always appear even with 0 counts
  for (const key of seedKeys) {
    const parts = key.split("/");
    if (parts.length >= 1) ensurePath(parts[0]!, parts[1], parts[2]);
  }

  for (const queue of queues) {
    for (const group of queue.groups) {
      const pName = group.pipelineName ?? queue.displayName;
      const jType = group.jobType ?? "default";
      const jName = group.jobName ?? "default";

      ensurePath(pName, jType, jName);
      const nameMap = pipelineMap.get(pName)!.get(jType)!;
      const existing = nameMap.get(jName)!;
      existing.pending += group.pendingJobs;
      existing.active += group.hasActiveJob ? 1 : 0;
      existing.blocked += group.isBlocked ? 1 : 0;
    }
  }

  const tree: PipelineNode[] = [];
  for (const [pName, typeMap] of pipelineMap) {
    const typeChildren: PipelineNode[] = [];
    let pPending = 0, pActive = 0, pBlocked = 0;

    for (const [jType, nameMap] of typeMap) {
      const nameChildren: PipelineNode[] = [];
      let tPending = 0, tActive = 0, tBlocked = 0;

      for (const [jName, counts] of nameMap) {
        nameChildren.push({ name: jName, ...counts, children: [] });
        tPending += counts.pending;
        tActive += counts.active;
        tBlocked += counts.blocked;
      }

      typeChildren.push({ name: jType, pending: tPending, active: tActive, blocked: tBlocked, children: nameChildren });
      pPending += tPending;
      pActive += tActive;
      pBlocked += tBlocked;
    }

    tree.push({ name: pName, pending: pPending, active: pActive, blocked: pBlocked, children: typeChildren });
  }

  tree.sort((a, b) => a.name.localeCompare(b.name));
  return tree;
}

/** Aggregate per-job-name counters from Redis pipeline results across multiple queues. */
export function aggregateJobNameCounters({
  jobNameCounterKeys,
  jobNameCounterResults,
  queueCount,
}: {
  jobNameCounterKeys: Array<{ compositeKey: string; jobName: string }>;
  jobNameCounterResults: Array<[Error | null, unknown]> | null;
  queueCount: number;
}): Map<string, { completed: number; failed: number }> {
  const totals = new Map<string, { completed: number; failed: number }>();
  if (!jobNameCounterResults) return totals;

  for (let i = 0; i < jobNameCounterKeys.length; i++) {
    const { compositeKey } = jobNameCounterKeys[i]!;
    let completed = 0;
    let failed = 0;
    for (let q = 0; q < queueCount; q++) {
      const baseIdx = (i * queueCount + q) * 2;
      completed += Number(jobNameCounterResults[baseIdx]?.[1] ?? 0);
      failed += Number(jobNameCounterResults[baseIdx + 1]?.[1] ?? 0);
    }
    totals.set(compositeKey, { completed, failed });
  }

  return totals;
}

const EMPTY_PHASE = { pending: 0, active: 0, completedPerSec: 0, failedPerSec: 0, latencyP50Ms: 0, latencyP99Ms: 0, peakCompletedPerSec: 0, peakFailedPerSec: 0, peakLatencyP50Ms: 0, peakLatencyP99Ms: 0 } as const;

function emptyPhases(): DashboardData["phases"] {
  return {
    commands: { ...EMPTY_PHASE },
    projections: { ...EMPTY_PHASE },
    reactions: { ...EMPTY_PHASE },
  };
}

function mapJobTypeToPhase(jobType: string | null | undefined): "commands" | "projections" | "reactions" {
  if (!jobType) return "commands";
  const lower = jobType.toLowerCase();
  if (lower === "projection" || lower === "handler") return "projections";
  if (lower === "reactor" || lower === "reaction") return "reactions";
  return "commands";
}
