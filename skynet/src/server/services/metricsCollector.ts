import * as os from "node:os";
import type IORedis from "ioredis";
import type { DashboardData, PipelineNode, ThroughputPoint, QueueInfo, JobNameMetrics } from "../../shared/types.ts";
import { THROUGHPUT_BUFFER_SIZE, METRICS_COLLECT_INTERVAL_MS, REDIS_STATE_TTL_SECONDS } from "../../shared/constants.ts";

import { scanGroupQueues } from "./groupQueueScanner.ts";
import { getRedisInfo, type RedisInfo } from "./redis.ts";

const REDIS_STATE_KEY = "skynet:state";
const KNOWN_PIPELINES_KEY = "skynet:known-pipelines";

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
  private peakJobNames = new Map<string, { completedPerSec: number; failedPerSec: number; latencyP50Ms: number; latencyP99Ms: number }>();
  private currentJobNameMetrics: JobNameMetrics[] = [];
  private currentPausedKeys: string[] = [];
  private knownPipelinePaths: string[] = [];
  private isCollecting = false;
  /** Previous counter values for delta computation */
  private prevCompleted = new Map<string, number>();
  private prevFailed = new Map<string, number>();

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

    const treeSeedKeys = [...new Set([...this.currentPausedKeys, ...this.knownPipelinePaths])];
    const pipelineTree = buildPipelineTree(queues, treeSeedKeys);

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
      pausedKeys: this.currentPausedKeys,
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

    // Build per-jobName metrics (pending/active from group scan, no throughput)
    const jobNameCounts = this.buildJobNameCounts(queues);
    const jobNameMetrics: JobNameMetrics[] = [];
    for (const [key, counts] of jobNameCounts) {
      const jobName = key.split("::")[1] ?? key;
      const pipelineName = counts.pipelineName;
      const phase = counts.phase;

      const peak = this.peakJobNames.get(key) ?? { completedPerSec: 0, failedPerSec: 0, latencyP50Ms: 0, latencyP99Ms: 0 };
      this.peakJobNames.set(key, peak);

      jobNameMetrics.push({
        jobName,
        pipelineName,
        phase,
        pending: counts.pending,
        active: counts.active,
        completedPerSec: 0,
        failedPerSec: 0,
        latencyP50Ms: 0,
        latencyP99Ms: 0,
        peakCompletedPerSec: peak.completedPerSec,
        peakFailedPerSec: peak.failedPerSec,
        peakLatencyP50Ms: peak.latencyP50Ms,
        peakLatencyP99Ms: peak.latencyP99Ms,
      });
    }
    this.currentJobNameMetrics = jobNameMetrics;

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

      // Collect paused keys from all group queues
      const pausedKeySets = await Promise.all(
        this.groupQueueNames.map((name) =>
          this.redis.smembers(`${name}:gq:paused-jobs`),
        ),
      );
      this.currentPausedKeys = [...new Set(pausedKeySets.flat())];

      // Track known pipeline paths so the tree stays stable
      const discoveredPaths: string[] = [];
      for (const q of queues) {
        for (const g of q.groups) {
          const p = g.pipelineName ?? q.displayName;
          const t = g.jobType ?? "default";
          const n = g.jobName ?? "default";
          discoveredPaths.push(`${p}/${t}/${n}`);
        }
      }
      if (discoveredPaths.length > 0) {
        await this.redis.sadd(KNOWN_PIPELINES_KEY, ...discoveredPaths);
        await this.redis.expire(KNOWN_PIPELINES_KEY, 86400); // 24h TTL
      }
      const knownPaths = await this.redis.smembers(KNOWN_PIPELINES_KEY);
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

        const stagedDelta = (totalInFlight - this.lastTotalInFlight) + newCompleted + newFailed;
        this.currentStagedPerSec = Math.round((Math.max(0, stagedDelta) / elapsed) * 100) / 100;

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

function buildPipelineTree(queues: QueueInfo[], pausedKeys: string[] = []): PipelineNode[] {
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

  // Seed the tree from paused keys so they always appear even with 0 counts
  for (const key of pausedKeys) {
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
