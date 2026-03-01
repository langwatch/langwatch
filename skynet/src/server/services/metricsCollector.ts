import * as os from "node:os";
import { Queue } from "bullmq";
import type IORedis from "ioredis";
import type { DashboardData, PipelineNode, ThroughputPoint, QueueInfo, JobNameMetrics } from "../../shared/types.ts";
import { THROUGHPUT_BUFFER_SIZE, METRICS_COLLECT_INTERVAL_MS, REDIS_STATE_TTL_SECONDS } from "../../shared/constants.ts";

import { scanGroupQueues } from "./groupQueueScanner.ts";
import { getRedisInfo, type RedisInfo } from "./redis.ts";

const REDIS_STATE_KEY = "skynet:state";

interface PersistedMetricsState {
  version: 1;
  savedAt: number;
  peakCompletedPerSec: number;
  peakFailedPerSec: number;
  peakStagedPerSec: number;
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
  private currentStagedPerSec = 0;
  private currentCompletedPerSec = 0;
  private currentFailedPerSec = 0;
  private currentPhases: DashboardData["phases"] = emptyPhases();
  private currentLatencyP50Ms = 0;
  private currentLatencyP99Ms = 0;
  private peakCompletedPerSec = 0;
  private peakFailedPerSec = 0;
  private peakStagedPerSec = 0;
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
  private queueCache = new Map<string, Queue>();
  private peakJobNames = new Map<string, { completedPerSec: number; failedPerSec: number; latencyP50Ms: number; latencyP99Ms: number }>();
  private currentJobNameMetrics: JobNameMetrics[] = [];
  private isCollecting = false;

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
    // Evict stale queue cache entries
    this.evictStaleQueues(names);
  }

  getLatestQueues(): QueueInfo[] {
    return this.latestQueues;
  }

  getDashboardData(): DashboardData {
    const queues = this.latestQueues;
    const redisInfo = this.latestRedisInfo;

    let totalGroups = 0;
    let blockedGroups = 0;
    let totalPendingJobs = 0;

    for (const q of queues) {
      totalGroups += q.groups.length;
      blockedGroups += q.blockedGroupCount;
      totalPendingJobs += q.totalPendingJobs;
    }

    const pipelineTree = buildPipelineTree(queues);

    const mem = process.memoryUsage();

    return {
      totalGroups,
      blockedGroups,
      totalPendingJobs,
      throughputStagedPerSec: this.currentStagedPerSec,
      totalCompleted: this.latestTotalCompleted,
      totalFailed: this.latestTotalFailed,
      completedPerSec: this.currentCompletedPerSec,
      failedPerSec: this.currentFailedPerSec,
      peakCompletedPerSec: this.peakCompletedPerSec,
      peakFailedPerSec: this.peakFailedPerSec,
      peakStagedPerSec: this.peakStagedPerSec,
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
    };
  }

  private getQueue(name: string): Queue {
    let q = this.queueCache.get(name);
    if (!q) {
      // Type assertion: ioredis versions diverge in pnpm virtual store (project 5.10.0 vs bullmq's 5.9.3)
      // but are runtime-compatible
      q = new Queue(name, { connection: this.redis as never });
      this.queueCache.set(name, q);
    }
    return q;
  }

  private evictStaleQueues(currentNames: string[]): void {
    const currentSet = new Set(currentNames);
    for (const [name, queue] of this.queueCache) {
      if (!currentSet.has(name)) {
        queue.close().catch(() => {});
        this.queueCache.delete(name);
      }
    }
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
   * Fetch actual completed/failed Job objects from BullMQ, filter by
   * finishedOn > lastTimestamp to find newly-finished jobs, and derive
   * per-phase throughput + latency from those.
   *
   * BullMQ keeps ~100 completed jobs (removeOnComplete config) and 7 days
   * of failed jobs, so we always fetch up to 100 of each.
   */
  private async computeJobMetrics({
    queues,
    elapsed,
  }: {
    queues: QueueInfo[];
    elapsed: number;
  }): Promise<{ newCompleted: number; newFailed: number }> {
    const phases = this.aggregatePhaseCounts(queues);

    const phaseCompleted: Record<string, number> = { commands: 0, projections: 0, reactions: 0 };
    const phaseFailed: Record<string, number> = { commands: 0, projections: 0, reactions: 0 };
    const phaseLatencies: Record<string, number[]> = { commands: [], projections: [], reactions: [] };
    const allLatencies: number[] = [];

    // Per-jobName accumulators (keyed by "pipelineName::jobName")
    const jobNameCompleted = new Map<string, number>();
    const jobNameFailed = new Map<string, number>();
    const jobNameLatencies = new Map<string, number[]>();
    const jobNamePhases = new Map<string, { phase: "commands" | "projections" | "reactions"; pipelineName: string; jobName: string }>();

    let newCompleted = 0;
    let newFailed = 0;

    const jobFetchPromises = this.groupQueueNames.map(async (name) => {
      try {
        const q = this.getQueue(name);
        const [completed, failed] = await Promise.all([
          q.getJobs(["completed"], 0, 99),
          q.getJobs(["failed"], 0, 99),
        ]);
        return { completed, failed };
      } catch {
        return { completed: [] as Awaited<ReturnType<Queue["getJobs"]>>, failed: [] as Awaited<ReturnType<Queue["getJobs"]>> };
      }
    });
    const allResults = await Promise.all(jobFetchPromises);

    for (const result of allResults) {
      for (const job of result.completed) {
        if (!job) continue;
        const phase = mapJobTypeToPhase(job.data?.__jobType as string | null | undefined);
        const jn = (job.data?.__jobName as string) ?? "unknown";
        const pn = (job.data?.__pipelineName as string) ?? "unknown";
        const jnKey = `${pn}::${jn}`;

        if (!jobNamePhases.has(jnKey)) {
          jobNamePhases.set(jnKey, { phase, pipelineName: pn, jobName: jn });
        }

        // Count new completions (finished after last cycle)
        if (job.finishedOn && job.finishedOn > this.lastTimestamp) {
          phaseCompleted[phase]!++;
          newCompleted++;
          jobNameCompleted.set(jnKey, (jobNameCompleted.get(jnKey) ?? 0) + 1);
        }

        // Collect latency from ALL fetched completed jobs for stable p50
        if (job.finishedOn && job.timestamp) {
          const lat = job.finishedOn - job.timestamp;
          phaseLatencies[phase]!.push(lat);
          allLatencies.push(lat);
          if (!jobNameLatencies.has(jnKey)) jobNameLatencies.set(jnKey, []);
          jobNameLatencies.get(jnKey)!.push(lat);
        }
      }

      for (const job of result.failed) {
        if (!job) continue;
        if (job.finishedOn && job.finishedOn > this.lastTimestamp) {
          const phase = mapJobTypeToPhase(job.data?.__jobType as string | null | undefined);
          const jn = (job.data?.__jobName as string) ?? "unknown";
          const pn = (job.data?.__pipelineName as string) ?? "unknown";
          const jnKey = `${pn}::${jn}`;
          phaseFailed[phase]!++;
          newFailed++;
          jobNameFailed.set(jnKey, (jobNameFailed.get(jnKey) ?? 0) + 1);
          if (!jobNamePhases.has(jnKey)) {
            jobNamePhases.set(jnKey, { phase, pipelineName: pn, jobName: jn });
          }
        }
      }
    }

    for (const key of ["commands", "projections", "reactions"] as const) {
      phases[key].completedPerSec = elapsed > 0 ? Math.round((phaseCompleted[key]! / elapsed) * 100) / 100 : 0;
      phases[key].failedPerSec = elapsed > 0 ? Math.round((phaseFailed[key]! / elapsed) * 100) / 100 : 0;
      phases[key].latencyP50Ms = median(phaseLatencies[key]!);
      phases[key].latencyP99Ms = percentile(phaseLatencies[key]!, 0.99);

      // Update per-phase peaks
      const pp = this.peakPhases[key]!;
      pp.completedPerSec = Math.max(pp.completedPerSec, phases[key].completedPerSec);
      pp.failedPerSec = Math.max(pp.failedPerSec, phases[key].failedPerSec);
      pp.latencyP50Ms = Math.max(pp.latencyP50Ms, phases[key].latencyP50Ms);
      pp.latencyP99Ms = Math.max(pp.latencyP99Ms, phases[key].latencyP99Ms);

      phases[key].peakCompletedPerSec = pp.completedPerSec;
      phases[key].peakFailedPerSec = pp.failedPerSec;
      phases[key].peakLatencyP50Ms = pp.latencyP50Ms;
      phases[key].peakLatencyP99Ms = pp.latencyP99Ms;
    }

    this.currentPhases = phases;

    // Build per-jobName metrics
    const jobNameCounts = this.buildJobNameCounts(queues);
    const allJobNameKeys = new Set([...jobNameCounts.keys(), ...jobNamePhases.keys()]);
    const jobNameMetrics: JobNameMetrics[] = [];
    for (const key of allJobNameKeys) {
      const counts = jobNameCounts.get(key);
      const info = jobNamePhases.get(key);
      const jobName = info?.jobName ?? key.split("::")[1] ?? key;
      const pipelineName = info?.pipelineName ?? counts?.pipelineName ?? "unknown";
      const phase = info?.phase ?? counts?.phase ?? "commands";

      const completed = jobNameCompleted.get(key) ?? 0;
      const failed = jobNameFailed.get(key) ?? 0;
      const lats = jobNameLatencies.get(key) ?? [];

      const completedPerSec = elapsed > 0 ? Math.round((completed / elapsed) * 100) / 100 : 0;
      const failedPerSec = elapsed > 0 ? Math.round((failed / elapsed) * 100) / 100 : 0;
      const latencyP50Ms = median(lats);
      const latencyP99Ms = percentile(lats, 0.99);

      // Update peaks
      const peak = this.peakJobNames.get(key) ?? { completedPerSec: 0, failedPerSec: 0, latencyP50Ms: 0, latencyP99Ms: 0 };
      peak.completedPerSec = Math.max(peak.completedPerSec, completedPerSec);
      peak.failedPerSec = Math.max(peak.failedPerSec, failedPerSec);
      peak.latencyP50Ms = Math.max(peak.latencyP50Ms, latencyP50Ms);
      peak.latencyP99Ms = Math.max(peak.latencyP99Ms, latencyP99Ms);
      this.peakJobNames.set(key, peak);

      jobNameMetrics.push({
        jobName,
        pipelineName,
        phase,
        pending: counts?.pending ?? 0,
        active: counts?.active ?? 0,
        completedPerSec,
        failedPerSec,
        latencyP50Ms,
        latencyP99Ms,
        peakCompletedPerSec: peak.completedPerSec,
        peakFailedPerSec: peak.failedPerSec,
        peakLatencyP50Ms: peak.latencyP50Ms,
        peakLatencyP99Ms: peak.latencyP99Ms,
      });
    }
    this.currentJobNameMetrics = jobNameMetrics;

    this.currentLatencyP50Ms = median(allLatencies);
    this.currentLatencyP99Ms = percentile(allLatencies, 0.99);

    // Update aggregate peaks
    this.peakLatencyP50Ms = Math.max(this.peakLatencyP50Ms, this.currentLatencyP50Ms);
    this.peakLatencyP99Ms = Math.max(this.peakLatencyP99Ms, this.currentLatencyP99Ms);

    return { newCompleted, newFailed };
  }

  private async restoreState(): Promise<void> {
    try {
      const raw = await this.redis.get(REDIS_STATE_KEY);
      if (!raw) return;

      const state: PersistedMetricsState = JSON.parse(raw);
      if (state.version !== 1) return;

      this.peakCompletedPerSec = state.peakCompletedPerSec;
      this.peakFailedPerSec = state.peakFailedPerSec;
      this.peakStagedPerSec = state.peakStagedPerSec;
      this.peakLatencyP50Ms = state.peakLatencyP50Ms;
      this.peakLatencyP99Ms = state.peakLatencyP99Ms;

      for (const [key, value] of Object.entries(state.peakPhases)) {
        this.peakPhases[key] = { ...value };
      }

      for (const [key, value] of state.peakJobNames) {
        this.peakJobNames.set(key, { ...value });
      }

      // Filter out throughput points older than the buffer window
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
      version: 1,
      savedAt: Date.now(),
      peakCompletedPerSec: this.peakCompletedPerSec,
      peakFailedPerSec: this.peakFailedPerSec,
      peakStagedPerSec: this.peakStagedPerSec,
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

      let totalPending = 0;
      for (const q of queues) {
        totalPending += q.totalPendingJobs;
      }

      // Get waiting + active counts from BullMQ for totalInFlight calculation
      const countPromises = this.groupQueueNames.map(async (name) => {
        try {
          const q = this.getQueue(name);
          const counts = await q.getJobCounts();
          return {
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
          };
        } catch {
          return { waiting: 0, active: 0 };
        }
      });
      const countResults = await Promise.all(countPromises);

      let totalWaiting = 0;
      let totalActive = 0;
      for (const r of countResults) {
        totalWaiting += r.waiting;
        totalActive += r.active;
      }

      // totalInFlight = staging pending + BullMQ waiting + BullMQ active
      const totalInFlight = totalPending + totalWaiting + totalActive;

      const now = Date.now();
      const elapsed = (now - this.lastTimestamp) / 1000;

      // Always fetch job objects to get accurate throughput + latency
      const { newCompleted, newFailed } = await this.computeJobMetrics({
        queues,
        elapsed: this.hasBaseline ? elapsed : 0,
      });

      // Maintain cumulative running totals
      this.latestTotalCompleted += newCompleted;
      this.latestTotalFailed += newFailed;

      if (this.hasBaseline && elapsed > 0) {
        this.currentCompletedPerSec = Math.round((newCompleted / elapsed) * 100) / 100;
        this.currentFailedPerSec = Math.round((newFailed / elapsed) * 100) / 100;

        // stagedDelta = change in in-flight + what left (completed + failed)
        const stagedDelta = (totalInFlight - this.lastTotalInFlight) + newCompleted + newFailed;
        this.currentStagedPerSec = Math.round((Math.max(0, stagedDelta) / elapsed) * 100) / 100;

        // Update aggregate peaks
        this.peakCompletedPerSec = Math.max(this.peakCompletedPerSec, this.currentCompletedPerSec);
        this.peakFailedPerSec = Math.max(this.peakFailedPerSec, this.currentFailedPerSec);
        this.peakStagedPerSec = Math.max(this.peakStagedPerSec, this.currentStagedPerSec);
      }

      this.lastTotalInFlight = totalInFlight;
      this.lastTimestamp = now;
      this.hasBaseline = true;

      this.throughputBuffer.push({
        timestamp: now,
        stagedPerSec: this.currentStagedPerSec,
        completedPerSec: this.currentCompletedPerSec,
        failedPerSec: this.currentFailedPerSec,
      });

      if (this.throughputBuffer.length > THROUGHPUT_BUFFER_SIZE) {
        this.throughputBuffer.shift();
      }

      // Track CPU usage
      const cpuNow = process.cpuUsage(this.lastCpuUsage);
      const cpuElapsed = now - this.lastCpuTime;
      if (cpuElapsed > 0) {
        // cpuUsage returns microseconds; convert to percentage of wall time
        const totalCpuUs = cpuNow.user + cpuNow.system;
        this.currentCpuPercent = (totalCpuUs / 1000 / cpuElapsed) * 100;
      }
      this.lastCpuUsage = process.cpuUsage();
      this.lastCpuTime = now;

      this.persistState().catch((err) => console.warn("Failed to persist metrics state:", err));
    } catch (err) {
      console.error("Metrics collection error:", err);
    } finally {
      this.isCollecting = false;
    }
  }
}

function buildPipelineTree(queues: QueueInfo[]): PipelineNode[] {
  const pipelineMap = new Map<string, Map<string, Map<string, { pending: number; active: number; blocked: number }>>>();

  for (const queue of queues) {
    for (const group of queue.groups) {
      const pName = group.pipelineName ?? queue.displayName;
      const jType = group.jobType ?? "default";
      const jName = group.jobName ?? "default";

      if (!pipelineMap.has(pName)) pipelineMap.set(pName, new Map());
      const typeMap = pipelineMap.get(pName)!;
      if (!typeMap.has(jType)) typeMap.set(jType, new Map());
      const nameMap = typeMap.get(jType)!;

      const existing = nameMap.get(jName) ?? { pending: 0, active: 0, blocked: 0 };
      existing.pending += group.pendingJobs;
      existing.active += group.hasActiveJob ? 1 : 0;
      existing.blocked += group.isBlocked ? 1 : 0;
      nameMap.set(jName, existing);
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

const EMPTY_PHASE = { pending: 0, active: 0, completedPerSec: 0, failedPerSec: 0, latencyP50Ms: 0, latencyP99Ms: 0, peakCompletedPerSec: 0, peakFailedPerSec: 0, peakLatencyP50Ms: 0, peakLatencyP99Ms: 0 } as const;

function emptyPhases(): DashboardData["phases"] {
  return {
    commands: { ...EMPTY_PHASE },
    projections: { ...EMPTY_PHASE },
    reactions: { ...EMPTY_PHASE },
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

function mapJobTypeToPhase(jobType: string | null | undefined): "commands" | "projections" | "reactions" {
  if (!jobType) return "commands";
  const lower = jobType.toLowerCase();
  if (lower === "projection" || lower === "handler") return "projections";
  if (lower === "reactor" || lower === "reaction") return "reactions";
  return "commands";
}
