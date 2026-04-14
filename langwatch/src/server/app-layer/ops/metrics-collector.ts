import * as os from "node:os";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import type { NextApiResponse } from "next";
import type {
  DashboardData,
  PipelineNode,
  ThroughputPoint,
  QueueInfo,
  QueueSummaryInfo,
  JobNameMetrics,
  RedisInfo,
} from "./types";
import type { QueueRepository } from "./repositories/queue.repository";
import { normalizeErrorMessage } from "./normalize-error-message";

const THROUGHPUT_BUFFER_SIZE = 900;
const METRICS_COLLECT_INTERVAL_MS = 2_000;
const SSE_PUSH_INTERVAL_MS = 2_000;
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;
const REDIS_STATE_TTL_SECONDS = 3600;
const QUEUE_DISCOVERY_INTERVAL_MS = 10_000;

const REDIS_STATE_KEY = "ops:metrics:state";
const KNOWN_PIPELINES_KEY = "ops:known-pipelines";
const JOB_NAME_COUNTER_PREFIX = "jn:";

interface PersistedMetricsState {
  version: 3;
  savedAt: number;
  peakCompletedPerSec: number;
  peakFailedPerSec: number;
  peakIngestedPerSec: number;
  peakLatencyP50Ms: number;
  peakLatencyP99Ms: number;
  peakPhases: Record<
    string,
    {
      completedPerSec: number;
      failedPerSec: number;
      latencyP50Ms: number;
      latencyP99Ms: number;
    }
  >;
  peakJobNames: Array<
    [
      string,
      {
        completedPerSec: number;
        failedPerSec: number;
        latencyP50Ms: number;
        latencyP99Ms: number;
      },
    ]
  >;
  throughputBuffer: ThroughputPoint[];
  latestTotalCompleted: number;
  latestTotalFailed: number;
}

interface SSEClient {
  id: string;
  res: NextApiResponse;
}

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

function emptyPhases(): DashboardData["phases"] {
  return {
    commands: { ...EMPTY_PHASE },
    projections: { ...EMPTY_PHASE },
    reactions: { ...EMPTY_PHASE },
  };
}

function mapJobTypeToPhase(
  jobType: string | null | undefined,
): "commands" | "projections" | "reactions" {
  if (!jobType) return "commands";
  const lower = jobType.toLowerCase();
  if (lower === "projection" || lower === "handler") return "projections";
  if (lower === "reactor" || lower === "reaction") return "reactions";
  return "commands";
}

function normalizeJobType(jobType: string): string {
  const lower = jobType.toLowerCase();
  if (lower === "handler" || lower === "projection") return "fold";
  if (lower === "reaction") return "reactor";
  return jobType;
}

export function buildPipelineTree({
  queues,
  seedKeys = [],
}: {
  queues: QueueInfo[];
  seedKeys?: string[];
}): PipelineNode[] {
  const pipelineMap = new Map<
    string,
    Map<string, Map<string, { pending: number; active: number; blocked: number }>>
  >();

  const ensurePath = (pName: string, jType?: string, jName?: string) => {
    if (!pipelineMap.has(pName)) pipelineMap.set(pName, new Map());
    if (jType) {
      const normalized = normalizeJobType(jType);
      const typeMap = pipelineMap.get(pName)!;
      if (!typeMap.has(normalized)) typeMap.set(normalized, new Map());
      if (jName) {
        const nameMap = typeMap.get(normalized)!;
        if (!nameMap.has(jName))
          nameMap.set(jName, { pending: 0, active: 0, blocked: 0 });
      }
    }
  };

  for (const key of seedKeys) {
    const parts = key.split("/");
    if (parts.length >= 1) ensurePath(parts[0]!, parts[1], parts[2]);
  }

  for (const queue of queues) {
    for (const group of queue.groups) {
      const pName = group.pipelineName ?? queue.displayName;
      const jType = normalizeJobType(group.jobType ?? "default");
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
    let pPending = 0,
      pActive = 0,
      pBlocked = 0;

    for (const [jType, nameMap] of typeMap) {
      const nameChildren: PipelineNode[] = [];
      let tPending = 0,
        tActive = 0,
        tBlocked = 0;

      for (const [jName, counts] of nameMap) {
        nameChildren.push({ name: jName, ...counts, children: [] });
        tPending += counts.pending;
        tActive += counts.active;
        tBlocked += counts.blocked;
      }

      typeChildren.push({
        name: jType,
        pending: tPending,
        active: tActive,
        blocked: tBlocked,
        children: nameChildren,
      });
      pPending += tPending;
      pActive += tActive;
      pBlocked += tBlocked;
    }

    tree.push({
      name: pName,
      pending: pPending,
      active: pActive,
      blocked: pBlocked,
      children: typeChildren,
    });
  }

  tree.sort((a, b) => a.name.localeCompare(b.name));
  return tree;
}

class OpsMetricsCollector {
  private redis: IORedis | Cluster;
  private groupQueueNames: string[] = [];
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
  private peakPhases: Record<
    string,
    {
      completedPerSec: number;
      failedPerSec: number;
      latencyP50Ms: number;
      latencyP99Ms: number;
    }
  > = {
    commands: {
      completedPerSec: 0,
      failedPerSec: 0,
      latencyP50Ms: 0,
      latencyP99Ms: 0,
    },
    projections: {
      completedPerSec: 0,
      failedPerSec: 0,
      latencyP50Ms: 0,
      latencyP99Ms: 0,
    },
    reactions: {
      completedPerSec: 0,
      failedPerSec: 0,
      latencyP50Ms: 0,
      latencyP99Ms: 0,
    },
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
  private collectInterval: ReturnType<typeof setInterval> | null = null;
  private discoveryInterval: ReturnType<typeof setInterval> | null = null;
  private broadcastInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastCpuUsage = process.cpuUsage();
  private lastCpuTime = Date.now();
  private currentCpuPercent = 0;
  private peakJobNames = new Map<
    string,
    {
      completedPerSec: number;
      failedPerSec: number;
      latencyP50Ms: number;
      latencyP99Ms: number;
    }
  >();
  private currentJobNameMetrics: JobNameMetrics[] = [];
  private currentPausedKeys: string[] = [];
  private knownPipelinePaths: string[] = [];
  private isCollecting = false;
  private prevCompleted = new Map<string, number>();
  private prevFailed = new Map<string, number>();
  private clients: SSEClient[] = [];
  private clientCounter = 0;

  private queueRepo: QueueRepository;

  constructor(params: {
    redis: IORedis | Cluster;
    queueRepo: QueueRepository;
  }) {
    this.redis = params.redis;
    this.queueRepo = params.queueRepo;
  }

  async start(): Promise<void> {
    await this.restoreState();
    await this.discoverQueues();
    this.collect();
    this.collectInterval = setInterval(
      () => this.collect(),
      METRICS_COLLECT_INTERVAL_MS,
    );
    this.discoveryInterval = setInterval(
      () => this.discoverQueues(),
      QUEUE_DISCOVERY_INTERVAL_MS,
    );
    this.broadcastInterval = setInterval(() => {
      if (this.clients.length === 0) return;
      try {
        const data = this.getDashboardData();
        this.broadcast("dashboard", data);
      } catch {
        // ignore broadcast errors
      }
    }, SSE_PUSH_INTERVAL_MS);
    this.heartbeatInterval = setInterval(() => {
      this.broadcast("heartbeat", { timestamp: Date.now() });
    }, SSE_HEARTBEAT_INTERVAL_MS);
  }

  stop(): void {
    if (this.collectInterval) {
      clearInterval(this.collectInterval);
      this.collectInterval = null;
    }
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const client of this.clients) {
      client.res.end();
    }
    this.clients = [];
  }

  addClient(res: NextApiResponse): string {
    const id = `client-${++this.clientCounter}`;
    const client: SSEClient = { id, res };
    this.clients.push(client);

    res.on("close", () => {
      this.clients = this.clients.filter((c) => c.id !== id);
    });

    return id;
  }

  removeClient(res: NextApiResponse): void {
    this.clients = this.clients.filter((c) => c.res !== res);
  }

  private broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.res.write(payload);
      } catch {
        // client disconnected
      }
    }
  }

  private async discoverQueues(): Promise<void> {
    try {
      this.groupQueueNames = await this.queueRepo.discoverQueueNames();
    } catch {
      // keep existing names on error
    }
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

    const treeSeedKeys = [
      ...new Set([...this.currentPausedKeys, ...this.knownPipelinePaths]),
    ];
    const pipelineTree = buildPipelineTree({
      queues: fullQueues,
      seedKeys: treeSeedKeys,
    });

    const errorMap = new Map<
      string,
      {
        normalizedMessage: string;
        sampleMessage: string;
        sampleStack: string | null;
        count: number;
        pipelineName: string | null;
        queueName: string;
        sampleGroupIds: string[];
      }
    >();
    for (const q of fullQueues) {
      for (const g of q.groups) {
        if (!g.isBlocked || !g.errorMessage) continue;
        const normalized = normalizeErrorMessage(g.errorMessage);
        const key = `${g.pipelineName ?? ""}::${normalized}`;
        const existing = errorMap.get(key);
        if (existing) {
          existing.count++;
          if (existing.sampleGroupIds.length < 5)
            existing.sampleGroupIds.push(g.groupId);
        } else {
          errorMap.set(key, {
            normalizedMessage: normalized,
            sampleMessage: g.errorMessage,
            sampleStack: g.errorStack,
            count: 1,
            pipelineName: g.pipelineName,
            queueName: q.name,
            sampleGroupIds: [g.groupId],
          });
        }
      }
    }
    const topErrors = Array.from(errorMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const queues: QueueSummaryInfo[] = fullQueues.map(
      ({ groups: _groups, ...summary }) => summary,
    );

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

  private buildJobNameCounts(
    queues: QueueInfo[],
  ): Map<
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
        const phase = mapJobTypeToPhase(g.jobType);
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

  private async computeJobMetrics({
    queues,
    elapsed,
  }: {
    queues: QueueInfo[];
    elapsed: number;
  }): Promise<{ newCompleted: number; newFailed: number }> {
    const phases = this.aggregatePhaseCounts(queues);

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

        if (this.prevCompleted.has(name)) {
          newCompleted += Math.max(0, completedTotal - prevC);
          newFailed += Math.max(0, failedTotal - prevF);
        }

        this.prevCompleted.set(name, completedTotal);
        this.prevFailed.set(name, failedTotal);
      }
    }

    const latencies: number[] = [];
    if (newCompleted > 0 || !this.hasBaseline) {
      const latencyPipeline = this.redis.pipeline();
      for (const name of this.groupQueueNames) {
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
            jobIdPipeline.hmget(
              `${name}:${jobId}`,
              "processedOn",
              "finishedOn",
            );
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
      const p99Idx = Math.min(
        latencies.length - 1,
        Math.floor(latencies.length * 0.99),
      );
      this.currentLatencyP50Ms = latencies[p50Idx]!;
      this.currentLatencyP99Ms = latencies[p99Idx]!;
      this.peakLatencyP50Ms = Math.max(
        this.peakLatencyP50Ms,
        this.currentLatencyP50Ms,
      );
      this.peakLatencyP99Ms = Math.max(
        this.peakLatencyP99Ms,
        this.currentLatencyP99Ms,
      );
    }

    for (const key of ["commands", "projections", "reactions"] as const) {
      const pp = this.peakPhases[key]!;
      phases[key].peakCompletedPerSec = pp.completedPerSec;
      phases[key].peakFailedPerSec = pp.failedPerSec;
      phases[key].peakLatencyP50Ms = pp.latencyP50Ms;
      phases[key].peakLatencyP99Ms = pp.latencyP99Ms;
    }
    this.currentPhases = phases;

    this.currentJobNameMetrics = await this.computeJobNameThroughput(
      queues,
      elapsed,
    );

    return { newCompleted, newFailed };
  }

  private async computeJobNameThroughput(
    queues: QueueInfo[],
    elapsed: number,
  ): Promise<JobNameMetrics[]> {
    const jobNameCounts = this.buildJobNameCounts(queues);

    const uniqueJobNames = new Set<string>();
    for (const [compositeKey] of jobNameCounts) {
      uniqueJobNames.add(compositeKey.split("::")[1] ?? compositeKey);
    }

    const jobNameCounterPipeline = this.redis.pipeline();
    const dedupedJobNames: string[] = [];
    for (const jobName of uniqueJobNames) {
      for (const queueName of this.groupQueueNames) {
        jobNameCounterPipeline.get(
          `${queueName}:gq:stats:completed:${jobName}`,
        );
        jobNameCounterPipeline.get(
          `${queueName}:gq:stats:failed:${jobName}`,
        );
      }
      dedupedJobNames.push(jobName);
    }
    const jobNameCounterResults =
      dedupedJobNames.length > 0
        ? await jobNameCounterPipeline.exec()
        : [];

    const jobNameTotals = new Map<
      string,
      { completed: number; failed: number }
    >();
    if (jobNameCounterResults) {
      for (let i = 0; i < dedupedJobNames.length; i++) {
        let completed = 0;
        let failed = 0;
        for (let q = 0; q < this.groupQueueNames.length; q++) {
          const baseIdx = (i * this.groupQueueNames.length + q) * 2;
          completed += Number(jobNameCounterResults[baseIdx]?.[1] ?? 0);
          failed += Number(jobNameCounterResults[baseIdx + 1]?.[1] ?? 0);
        }
        jobNameTotals.set(dedupedJobNames[i]!, { completed, failed });
      }
    }

    const metrics: JobNameMetrics[] = [];
    for (const [compositeKey, counts] of jobNameCounts) {
      const jobName = compositeKey.split("::")[1] ?? compositeKey;

      const totals = jobNameTotals.get(jobName) ?? {
        completed: 0,
        failed: 0,
      };
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

      const peak = this.peakJobNames.get(compositeKey) ?? {
        completedPerSec: 0,
        failedPerSec: 0,
        latencyP50Ms: 0,
        latencyP99Ms: 0,
      };
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
      if (state.version !== 3) return;

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

      const cutoff =
        Date.now() - THROUGHPUT_BUFFER_SIZE * METRICS_COLLECT_INTERVAL_MS;
      this.throughputBuffer = state.throughputBuffer.filter(
        (p) => p.timestamp > cutoff,
      );

      this.latestTotalCompleted = state.latestTotalCompleted;
      this.latestTotalFailed = state.latestTotalFailed;
    } catch {
      // start fresh on error
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
    await this.redis.set(
      REDIS_STATE_KEY,
      JSON.stringify(state),
      "EX",
      REDIS_STATE_TTL_SECONDS,
    );
  }

  private async getRedisInfo(): Promise<RedisInfo> {
    const info = await this.redis.info();
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
    };
  }

  private async collect(): Promise<void> {
    if (this.isCollecting) return;
    this.isCollecting = true;
    try {
      const [queues, redisInfo] = await Promise.all([
        this.queueRepo.scanQueues({ queueNames: this.groupQueueNames }),
        this.getRedisInfo(),
      ]);
      this.latestQueues = queues;
      this.latestRedisInfo = redisInfo;

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
        const pipelineBatch = this.redis.pipeline();
        for (const path of discoveredPaths) {
          pipelineBatch.zadd(KNOWN_PIPELINES_KEY, timestamp, path);
        }
        pipelineBatch.zremrangebyscore(
          KNOWN_PIPELINES_KEY,
          0,
          timestamp - 86400 * 1000,
        );
        await pipelineBatch.exec();
      }
      const knownPaths = await this.redis.zrange(
        KNOWN_PIPELINES_KEY,
        0,
        9999,
      );
      this.knownPipelinePaths = knownPaths;

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
        this.currentCompletedPerSec =
          Math.round((newCompleted / elapsed) * 100) / 100;
        this.currentFailedPerSec =
          Math.round((newFailed / elapsed) * 100) / 100;

        const ingestedDelta =
          totalInFlight - this.lastTotalInFlight + newCompleted + newFailed;
        this.currentIngestedPerSec =
          Math.round((Math.max(0, ingestedDelta) / elapsed) * 100) / 100;

        this.peakCompletedPerSec = Math.max(
          this.peakCompletedPerSec,
          this.currentCompletedPerSec,
        );
        this.peakFailedPerSec = Math.max(
          this.peakFailedPerSec,
          this.currentFailedPerSec,
        );
        this.peakIngestedPerSec = Math.max(
          this.peakIngestedPerSec,
          this.currentIngestedPerSec,
        );
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

      const cpuNow = process.cpuUsage(this.lastCpuUsage);
      const cpuElapsed = now - this.lastCpuTime;
      if (cpuElapsed > 0) {
        const totalCpuUs = cpuNow.user + cpuNow.system;
        this.currentCpuPercent = (totalCpuUs / 1000 / cpuElapsed) * 100;
      }
      this.lastCpuUsage = process.cpuUsage();
      this.lastCpuTime = now;

      this.persistState().catch(() => {});
    } catch {
      // collection error, retry next interval
    } finally {
      this.isCollecting = false;
    }
  }
}

let singleton: OpsMetricsCollector | null = null;

export function getOpsMetricsCollector(params: {
  redis: IORedis | Cluster;
  queueRepo: QueueRepository;
}): OpsMetricsCollector {
  if (!singleton) {
    singleton = new OpsMetricsCollector(params);
    singleton.start().catch(() => {});
  }
  return singleton;
}

export type { OpsMetricsCollector };
