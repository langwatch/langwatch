import { EventEmitter } from "node:events";
import * as os from "node:os";
import { createLogger } from "@langwatch/observability";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { normalizeErrorMessage } from "./normalize-error-message";
import {
  computeEngineCpuPercent,
  type RedisCpuSample,
} from "./redis-engine-cpu";
import type { QueueRepository } from "./repositories/queue.repository";
import type {
  DashboardData,
  GroupInfo,
  JobNameMetrics,
  PipelineNode,
  QueueInfo,
  QueueSummaryInfo,
  RedisInfo,
  ThroughputPoint,
} from "./types";

const logger = createLogger("langwatch:ops:metrics-collector");

const THROUGHPUT_BUFFER_SIZE = 900;
const METRICS_COLLECT_INTERVAL_MS = 2_000;
const PENDING_RECONCILE_INTERVAL_MS = 60_000;
const DASHBOARD_BROADCAST_INTERVAL_MS = 2_000;
const REDIS_STATE_TTL_SECONDS = 3600;
const QUEUE_DISCOVERY_INTERVAL_MS = 10_000;
// Memoize badge counts for 5 seconds. The badge polls every 60s
// off-route, but this also covers concurrent calls from multiple tabs
// or layout remounts within the same window.
const BADGE_CACHE_TTL_MS = 5_000;

export const DASHBOARD_EVENT = "dashboard";

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

type PipelineCountMap = Map<
  string,
  Map<string, Map<string, { pending: number; active: number; blocked: number }>>
>;

function ensurePipelinePath({
  pipelineMap,
  pName,
  jType,
  jName,
}: {
  pipelineMap: PipelineCountMap;
  pName: string;
  jType?: string;
  jName?: string;
}): void {
  if (!pipelineMap.has(pName)) pipelineMap.set(pName, new Map());
  if (!jType) return;
  const normalized = normalizeJobType(jType);
  const typeMap = pipelineMap.get(pName)!;
  if (!typeMap.has(normalized)) typeMap.set(normalized, new Map());
  if (!jName) return;
  const nameMap = typeMap.get(normalized)!;
  if (!nameMap.has(jName))
    nameMap.set(jName, { pending: 0, active: 0, blocked: 0 });
}

function seedPipelinePaths({
  pipelineMap,
  seedKeys,
}: {
  pipelineMap: PipelineCountMap;
  seedKeys: string[];
}): void {
  for (const key of seedKeys) {
    const parts = key.split("/");
    if (parts.length >= 1)
      ensurePipelinePath({
        pipelineMap,
        pName: parts[0]!,
        jType: parts[1],
        jName: parts[2],
      });
  }
}

function accumulateGroupCount({
  pipelineMap,
  queue,
  group,
}: {
  pipelineMap: PipelineCountMap;
  queue: QueueInfo;
  group: GroupInfo;
}): void {
  const pName = group.pipelineName ?? queue.displayName;
  const jType = normalizeJobType(group.jobType ?? "default");
  const jName = group.jobName ?? "default";

  ensurePipelinePath({ pipelineMap, pName, jType, jName });
  const nameMap = pipelineMap.get(pName)!.get(jType)!;
  const existing = nameMap.get(jName)!;
  existing.pending += group.pendingJobs;
  existing.active += group.hasActiveJob ? 1 : 0;
  existing.blocked += group.isBlocked ? 1 : 0;
}

function accumulatePipelineCounts({
  pipelineMap,
  queues,
}: {
  pipelineMap: PipelineCountMap;
  queues: QueueInfo[];
}): void {
  for (const queue of queues) {
    for (const group of queue.groups) {
      accumulateGroupCount({ pipelineMap, queue, group });
    }
  }
}

function buildPipelineNameChildren(
  nameMap: Map<string, { pending: number; active: number; blocked: number }>,
): {
  children: PipelineNode[];
  pending: number;
  active: number;
  blocked: number;
} {
  const nameChildren: PipelineNode[] = [];
  let pending = 0,
    active = 0,
    blocked = 0;

  for (const [jName, counts] of nameMap) {
    nameChildren.push({ name: jName, ...counts, children: [] });
    pending += counts.pending;
    active += counts.active;
    blocked += counts.blocked;
  }

  return { children: nameChildren, pending, active, blocked };
}

function buildPipelineTypeChildren(
  typeMap: Map<
    string,
    Map<string, { pending: number; active: number; blocked: number }>
  >,
): {
  children: PipelineNode[];
  pending: number;
  active: number;
  blocked: number;
} {
  const typeChildren: PipelineNode[] = [];
  let pPending = 0,
    pActive = 0,
    pBlocked = 0;

  for (const [jType, nameMap] of typeMap) {
    const {
      children: nameChildren,
      pending,
      active,
      blocked,
    } = buildPipelineNameChildren(nameMap);

    typeChildren.push({
      name: jType,
      pending,
      active,
      blocked,
      children: nameChildren,
    });
    pPending += pending;
    pActive += active;
    pBlocked += blocked;
  }

  return {
    children: typeChildren,
    pending: pPending,
    active: pActive,
    blocked: pBlocked,
  };
}

export function buildPipelineTree({
  queues,
  seedKeys = [],
}: {
  queues: QueueInfo[];
  seedKeys?: string[];
}): PipelineNode[] {
  const pipelineMap: PipelineCountMap = new Map();

  seedPipelinePaths({ pipelineMap, seedKeys });
  accumulatePipelineCounts({ pipelineMap, queues });

  const tree: PipelineNode[] = [];
  for (const [pName, typeMap] of pipelineMap) {
    const {
      children: typeChildren,
      pending,
      active,
      blocked,
    } = buildPipelineTypeChildren(typeMap);

    tree.push({
      name: pName,
      pending,
      active,
      blocked,
      children: typeChildren,
    });
  }

  tree.sort((a, b) => a.name.localeCompare(b.name));
  return tree;
}

function summarizeQueueTotals(queues: QueueInfo[]): {
  totalGroups: number;
  blockedGroups: number;
  parkedGroups: number;
  totalPendingJobs: number;
} {
  let totalGroups = 0;
  let blockedGroups = 0;
  let parkedGroups = 0;
  let totalPendingJobs = 0;

  for (const q of queues) {
    totalGroups += q.groups.length;
    blockedGroups += q.blockedGroupCount;
    parkedGroups += q.parkedGroupCount;
    totalPendingJobs += q.totalPendingJobs;
  }

  return { totalGroups, blockedGroups, parkedGroups, totalPendingJobs };
}

interface ErrorSummaryEntry {
  normalizedMessage: string;
  sampleMessage: string;
  sampleStack: string | null;
  count: number;
  pipelineName: string | null;
  queueName: string;
  sampleGroupIds: string[];
}

function recordGroupError({
  errorMap,
  queue,
  group,
}: {
  errorMap: Map<string, ErrorSummaryEntry>;
  queue: QueueInfo;
  group: GroupInfo;
}): void {
  if (!group.isBlocked || !group.errorMessage) return;
  const normalized = normalizeErrorMessage(group.errorMessage);
  const key = `${group.pipelineName ?? ""}::${normalized}`;
  const existing = errorMap.get(key);
  if (existing) {
    existing.count++;
    if (existing.sampleGroupIds.length < 5)
      existing.sampleGroupIds.push(group.groupId);
  } else {
    errorMap.set(key, {
      normalizedMessage: normalized,
      sampleMessage: group.errorMessage,
      sampleStack: group.errorStack,
      count: 1,
      pipelineName: group.pipelineName,
      queueName: queue.name,
      sampleGroupIds: [group.groupId],
    });
  }
}

function buildTopErrors(queues: QueueInfo[]): ErrorSummaryEntry[] {
  const errorMap = new Map<string, ErrorSummaryEntry>();
  for (const q of queues) {
    for (const g of q.groups) {
      recordGroupError({ errorMap, queue: q, group: g });
    }
  }
  return Array.from(errorMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

interface JobNameCount {
  pending: number;
  active: number;
  phase: "commands" | "projections" | "reactions";
  pipelineName: string;
}

function flattenLatencyResults(
  latencyResults: Array<[error: Error | null, result: unknown]>,
): number[] {
  const latencies: number[] = [];
  for (const [, result] of latencyResults) {
    if (!Array.isArray(result)) continue;
    for (const raw of result) {
      const ms = Number(raw);
      if (Number.isFinite(ms) && ms >= 0) latencies.push(ms);
    }
  }
  return latencies;
}

function flattenPausedKeyResults(
  pausedResults: Array<[error: Error | null, result: unknown]>,
): Set<string> {
  const pausedKeysSet = new Set<string>();
  for (const [, result] of pausedResults) {
    if (Array.isArray(result)) {
      for (const key of result) pausedKeysSet.add(key as string);
    }
  }
  return pausedKeysSet;
}

function discoverPipelinePaths(queues: QueueInfo[]): Set<string> {
  const discoveredPaths = new Set<string>();
  for (const q of queues) {
    for (const g of q.groups) {
      const p = g.pipelineName ?? q.displayName;
      const t = g.jobType ?? "default";
      const n = g.jobName ?? "default";
      discoveredPaths.add(`${p}/${t}/${n}`);
    }
  }
  return discoveredPaths;
}

function computeInFlightTotals(queues: QueueInfo[]): {
  totalPending: number;
  totalActive: number;
  totalInFlight: number;
} {
  let totalPending = 0;
  let totalActive = 0;
  for (const q of queues) {
    totalPending += q.totalPendingJobs;
    totalActive += q.activeGroupCount;
  }
  return {
    totalPending,
    totalActive,
    totalInFlight: totalPending + totalActive,
  };
}

function computeBlockedParkedTotals(queues: QueueInfo[]): {
  totalBlockedCount: number;
  totalParkedCount: number;
} {
  let totalBlockedCount = 0;
  let totalParkedCount = 0;
  for (const q of queues) {
    totalBlockedCount += q.blockedGroupCount;
    totalParkedCount += q.parkedGroupCount;
  }
  return { totalBlockedCount, totalParkedCount };
}

function extractUniqueJobNames(
  jobNameCounts: Map<string, JobNameCount>,
): Set<string> {
  const uniqueJobNames = new Set<string>();
  for (const [compositeKey] of jobNameCounts) {
    uniqueJobNames.add(compositeKey.split("::")[1] ?? compositeKey);
  }
  return uniqueJobNames;
}

function buildJobNameTotals({
  dedupedJobNames,
  jobNameCounterResults,
  queueCount,
}: {
  dedupedJobNames: string[];
  jobNameCounterResults: Array<[error: Error | null, result: unknown]>;
  queueCount: number;
}): Map<string, { completed: number; failed: number }> {
  const jobNameTotals = new Map<
    string,
    { completed: number; failed: number }
  >();
  for (let i = 0; i < dedupedJobNames.length; i++) {
    let completed = 0;
    let failed = 0;
    for (let q = 0; q < queueCount; q++) {
      const baseIdx = (i * queueCount + q) * 2;
      completed += Number(jobNameCounterResults[baseIdx]?.[1] ?? 0);
      failed += Number(jobNameCounterResults[baseIdx + 1]?.[1] ?? 0);
    }
    jobNameTotals.set(dedupedJobNames[i]!, { completed, failed });
  }
  return jobNameTotals;
}

function accumulateJobNameCount({
  map,
  queue,
  group,
}: {
  map: Map<string, JobNameCount>;
  queue: QueueInfo;
  group: GroupInfo;
}): void {
  const jobName = group.jobName ?? "unknown";
  const pipelineName = group.pipelineName ?? queue.displayName;
  const phase = mapJobTypeToPhase(group.jobType);
  const key = `${pipelineName}::${jobName}`;
  const existing = map.get(key);
  if (existing) {
    existing.pending += group.pendingJobs;
    existing.active += group.hasActiveJob ? 1 : 0;
  } else {
    map.set(key, {
      pending: group.pendingJobs,
      active: group.hasActiveJob ? 1 : 0,
      phase,
      pipelineName,
    });
  }
}

export class OpsMetricsCollector {
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
  // Memoized badge-counts result. See `getBadgeCounts` for rationale.
  private badgeCountsCache: {
    blockedCount: number;
    dlqCount: number;
    computedAt: Date;
  } | null = null;
  private latestRedisInfo: RedisInfo = {
    usedMemoryHuman: "?",
    peakMemoryHuman: "?",
    usedMemoryBytes: 0,
    peakMemoryBytes: 0,
    maxMemoryBytes: 0,
    connectedClients: 0,
    usedCpuUserMainThreadSeconds: 0,
    usedCpuSysMainThreadSeconds: 0,
  };
  // Previous Redis CPU snapshot used to derive an engine-CPU percent between
  // successive collect() cycles. Null until the first sample lands. We sample
  // the *main-thread* counters specifically because Redis processes commands
  // on a single thread — that's the metric that pegs at 100% during
  // saturation (CloudWatch's `EngineCPUUtilization`).
  private prevRedisCpu: RedisCpuSample | null = null;
  private currentRedisEngineCpuPercent: number | null = null;
  private collectInterval: ReturnType<typeof setInterval> | null = null;
  private discoveryInterval: ReturnType<typeof setInterval> | null = null;
  private broadcastInterval: ReturnType<typeof setInterval> | null = null;
  private reconcileInterval: ReturnType<typeof setInterval> | null = null;
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
  private latestPendingDrift = 0;
  private knownPipelinePaths: string[] = [];
  private isCollecting = false;
  private prevCompleted = new Map<string, number>();
  private prevFailed = new Map<string, number>();
  private emitter = new EventEmitter();

  private queueRepo: QueueRepository;

  constructor(params: {
    redis: IORedis | Cluster;
    queueRepo: QueueRepository;
  }) {
    this.redis = params.redis;
    this.queueRepo = params.queueRepo;
    // Each tRPC subscriber adds one listener. The dashboard is admin-only;
    // raise the cap so we don't get MaxListenersExceededWarning under
    // multi-tab use without losing the leak signal entirely.
    this.emitter.setMaxListeners(100);
  }

  /** Event emitter used by the tRPC dashboardStream subscription. */
  getEmitter(): EventEmitter {
    return this.emitter;
  }

  async start(): Promise<void> {
    await this.restoreState();
    await this.discoverQueues();
    // Kick off the first collect without blocking start(); the interval below
    // will keep collecting on schedule. Errors are caught inside collect().
    void this.collect();
    this.collectInterval = setInterval(
      () => this.collect(),
      METRICS_COLLECT_INTERVAL_MS,
    );
    this.discoveryInterval = setInterval(
      () => this.discoverQueues(),
      QUEUE_DISCOVERY_INTERVAL_MS,
    );
    this.reconcileInterval = setInterval(
      () => this.reconcilePending(),
      PENDING_RECONCILE_INTERVAL_MS,
    );
    void this.reconcilePending();
    this.broadcastInterval = setInterval(() => {
      if (this.emitter.listenerCount(DASHBOARD_EVENT) === 0) return;
      try {
        this.emitter.emit(DASHBOARD_EVENT, this.getDashboardData());
      } catch (err) {
        logger.warn({ error: err }, "Failed to broadcast dashboard data");
      }
    }, DASHBOARD_BROADCAST_INTERVAL_MS);
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
    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval);
      this.reconcileInterval = null;
    }
    this.emitter.removeAllListeners();
  }

  async discoverQueues(): Promise<void> {
    try {
      this.groupQueueNames = await this.queueRepo.discoverQueueNames();
    } catch (err) {
      logger.warn(
        { error: err },
        "Queue discovery failed, keeping existing names",
      );
    }
  }

  /**
   * Lightweight per-call summary used by the global ops badge in the
   * main menu. Pulls only the two integers the badge renders, so the
   * global poll doesn't drag the full dashboard aggregation
   * (pipeline tree, error normalization, etc.) into every tRPC batch.
   * One slow procedure in a tRPC HTTP batch holds back every other
   * query that fired in the same window.
   *
   * The result is memoized for `BADGE_CACHE_TTL_MS` so any burst of
   * concurrent callers (multiple browser tabs, layout remounts, etc.)
   * shares a single computation. `latestQueues` is already a cached
   * snapshot, so this is mostly defense-in-depth — a future change
   * that makes the per-call work expensive would otherwise silently
   * regress the badge poll back into the slow tRPC batch path.
   *
   * `computedAt` ships back so the caller (and ops dashboards) can
   * tell exactly how stale the value is.
   */
  getBadgeCounts(): {
    blockedCount: number;
    dlqCount: number;
    computedAt: Date;
  } {
    const now = Date.now();
    if (
      this.badgeCountsCache &&
      now - this.badgeCountsCache.computedAt.getTime() < BADGE_CACHE_TTL_MS
    ) {
      return this.badgeCountsCache;
    }

    let blockedCount = 0;
    let dlqCount = 0;
    for (const q of this.latestQueues) {
      blockedCount += q.blockedGroupCount;
      dlqCount += q.dlqCount;
    }
    this.badgeCountsCache = {
      blockedCount,
      dlqCount,
      computedAt: new Date(now),
    };
    return this.badgeCountsCache;
  }

  private async reconcilePending(): Promise<void> {
    try {
      let totalDrift = 0;
      for (const queueName of this.groupQueueNames) {
        const result = await this.queueRepo.reconcileTotalPending(queueName);
        if (result) totalDrift += Math.abs(result.drift);
      }
      this.latestPendingDrift = totalDrift;
      if (totalDrift !== 0) {
        logger.info(
          { pendingDrift: totalDrift },
          "Reconciled GroupQueue pending counter to ground truth",
        );
      }
    } catch (err) {
      logger.warn({ error: err }, "Failed to reconcile pending counter");
    }
  }

  getDashboardData(): DashboardData {
    const fullQueues = this.latestQueues;
    const redisInfo = this.latestRedisInfo;

    const { totalGroups, blockedGroups, parkedGroups, totalPendingJobs } =
      summarizeQueueTotals(fullQueues);

    const treeSeedKeys = [
      ...new Set([...this.currentPausedKeys, ...this.knownPipelinePaths]),
    ];
    const pipelineTree = buildPipelineTree({
      queues: fullQueues,
      seedKeys: treeSeedKeys,
    });

    const topErrors = buildTopErrors(fullQueues);

    const queues: QueueSummaryInfo[] = fullQueues.map(
      ({ groups: _groups, ...summary }) => summary,
    );

    const mem = process.memoryUsage();

    return {
      totalGroups,
      blockedGroups,
      parkedGroups,
      totalPendingJobs,
      pendingDrift: this.latestPendingDrift,
      throughputIngestedPerSec: this.currentIngestedPerSec,
      totalCompleted: this.latestTotalCompleted,
      totalFailed: this.latestTotalFailed,
      completedPerSec: this.currentCompletedPerSec,
      failedPerSec: this.currentFailedPerSec,
      peakCompletedPerSec: this.peakCompletedPerSec,
      peakFailedPerSec: this.peakFailedPerSec,
      peakIngestedPerSec: this.peakIngestedPerSec,
      redisMemoryUsedBytes: redisInfo.usedMemoryBytes,
      redisMemoryPeakBytes: redisInfo.peakMemoryBytes,
      redisMemoryMaxBytes: redisInfo.maxMemoryBytes,
      redisConnectedClients: redisInfo.connectedClients,
      redisEngineCpuPercent: this.currentRedisEngineCpuPercent,
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

  private buildJobNameCounts(queues: QueueInfo[]): Map<string, JobNameCount> {
    const map = new Map<string, JobNameCount>();
    for (const q of queues) {
      for (const g of q.groups) {
        accumulateJobNameCount({ map, queue: q, group: g });
      }
    }
    return map;
  }

  /** Fetches per-queue completed/failed totals and folds them against the
   * previous snapshot to derive counts new since the last cycle. */
  /** Folds one queue's fetched totals against its previous snapshot, then
   * stores the new totals as the snapshot for the next cycle. Returns the
   * delta since the previous cycle (zero on the first sighting of a name). */
  private foldCounterDelta({
    name,
    completedTotal,
    failedTotal,
  }: {
    name: string;
    completedTotal: number;
    failedTotal: number;
  }): { completed: number; failed: number } {
    const prevC = this.prevCompleted.get(name) ?? 0;
    const prevF = this.prevFailed.get(name) ?? 0;
    const hasPrev = this.prevCompleted.has(name);

    this.prevCompleted.set(name, completedTotal);
    this.prevFailed.set(name, failedTotal);

    if (!hasPrev) return { completed: 0, failed: 0 };
    return {
      completed: Math.max(0, completedTotal - prevC),
      failed: Math.max(0, failedTotal - prevF),
    };
  }

  private async updateCompletedFailedCounters(): Promise<{
    newCompleted: number;
    newFailed: number;
  }> {
    const pipeline = this.redis.pipeline();
    for (const name of this.groupQueueNames) {
      pipeline.get(`${name}:gq:stats:completed`);
      pipeline.get(`${name}:gq:stats:failed`);
    }
    const results = await pipeline.exec();
    if (!results) return { newCompleted: 0, newFailed: 0 };

    let newCompleted = 0;
    let newFailed = 0;
    for (let i = 0; i < this.groupQueueNames.length; i++) {
      const delta = this.foldCounterDelta({
        name: this.groupQueueNames[i]!,
        completedTotal: Number(results[i * 2]?.[1] ?? 0),
        failedTotal: Number(results[i * 2 + 1]?.[1] ?? 0),
      });
      newCompleted += delta.completed;
      newFailed += delta.failed;
    }

    return { newCompleted, newFailed };
  }

  /** Pulls the raw per-job latency samples buffered since the last cycle.
   * Skipped when nothing completed and a baseline already exists, since
   * there is nothing new to read. */
  private async collectLatencySamples(newCompleted: number): Promise<number[]> {
    if (newCompleted <= 0 && this.hasBaseline) return [];

    const latencyPipeline = this.redis.pipeline();
    for (const name of this.groupQueueNames) {
      latencyPipeline.lrange(`${name}:gq:stats:latencies-ms`, 0, -1);
    }
    const latencyResults = await latencyPipeline.exec();
    if (!latencyResults) return [];

    return flattenLatencyResults(latencyResults);
  }

  /** Derives current P50/P99 from the sampled latencies and rolls them into
   * the running peaks. No-op when there is nothing to sample. */
  private applyLatencyPercentiles(latencies: number[]): void {
    if (latencies.length === 0) return;

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

  /** Stamps the persisted per-phase peaks onto this cycle's phase snapshot. */
  private applyPeakPhasesInto(phases: DashboardData["phases"]): void {
    for (const key of ["commands", "projections", "reactions"] as const) {
      const pp = this.peakPhases[key]!;
      phases[key].peakCompletedPerSec = pp.completedPerSec;
      phases[key].peakFailedPerSec = pp.failedPerSec;
      phases[key].peakLatencyP50Ms = pp.latencyP50Ms;
      phases[key].peakLatencyP99Ms = pp.latencyP99Ms;
    }
  }

  private async computeJobMetrics({
    queues,
    elapsed,
  }: {
    queues: QueueInfo[];
    elapsed: number;
  }): Promise<{ newCompleted: number; newFailed: number }> {
    const phases = this.aggregatePhaseCounts(queues);

    const { newCompleted, newFailed } =
      await this.updateCompletedFailedCounters();

    const latencies = await this.collectLatencySamples(newCompleted);
    this.applyLatencyPercentiles(latencies);

    this.applyPeakPhasesInto(phases);
    this.currentPhases = phases;

    this.currentJobNameMetrics = await this.computeJobNameThroughput(
      queues,
      elapsed,
    );

    return { newCompleted, newFailed };
  }

  /** Fetches per-job-name completed/failed totals across every group queue,
   * in the order `dedupedJobNames` lists them. */
  private async fetchJobNameCounterTotals(
    uniqueJobNames: Set<string>,
  ): Promise<{
    dedupedJobNames: string[];
    jobNameCounterResults: Array<[error: Error | null, result: unknown]>;
  }> {
    const jobNameCounterPipeline = this.redis.pipeline();
    const dedupedJobNames: string[] = [];
    for (const jobName of uniqueJobNames) {
      for (const queueName of this.groupQueueNames) {
        jobNameCounterPipeline.get(
          `${queueName}:gq:stats:completed:${jobName}`,
        );
        jobNameCounterPipeline.get(`${queueName}:gq:stats:failed:${jobName}`);
      }
      dedupedJobNames.push(jobName);
    }
    const jobNameCounterResults =
      dedupedJobNames.length > 0
        ? ((await jobNameCounterPipeline.exec()) ?? [])
        : [];

    return { dedupedJobNames, jobNameCounterResults };
  }

  /** Builds a single job's throughput metric, folding its fetched totals
   * against the previous cycle's snapshot and rolling the result into the
   * running per-job-name peaks. Mutates `prevCompleted`/`prevFailed`/
   * `peakJobNames` as a side effect, same as the inline version this
   * replaces. */
  private buildJobNameMetric({
    compositeKey,
    counts,
    totals,
    elapsed,
  }: {
    compositeKey: string;
    counts: JobNameCount;
    totals: { completed: number; failed: number };
    elapsed: number;
  }): JobNameMetrics {
    const jobName = compositeKey.split("::")[1] ?? compositeKey;

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

    return {
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
    };
  }

  private async computeJobNameThroughput(
    queues: QueueInfo[],
    elapsed: number,
  ): Promise<JobNameMetrics[]> {
    const jobNameCounts = this.buildJobNameCounts(queues);
    const uniqueJobNames = extractUniqueJobNames(jobNameCounts);

    const { dedupedJobNames, jobNameCounterResults } =
      await this.fetchJobNameCounterTotals(uniqueJobNames);

    const jobNameTotals = buildJobNameTotals({
      dedupedJobNames,
      jobNameCounterResults,
      queueCount: this.groupQueueNames.length,
    });

    const metrics: JobNameMetrics[] = [];
    for (const [compositeKey, counts] of jobNameCounts) {
      const jobName = compositeKey.split("::")[1] ?? compositeKey;
      const totals = jobNameTotals.get(jobName) ?? {
        completed: 0,
        failed: 0,
      };
      metrics.push(
        this.buildJobNameMetric({ compositeKey, counts, totals, elapsed }),
      );
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
      // Backfill parkedCount on points persisted before the Parked series
      // existed, so the chart never reads undefined/NaN for old history. The
      // state version is intentionally not bumped: this keeps the rolling
      // history AND the accumulated peaks across the deploy (a bump would zero
      // them, including the freshly-added Completed/s peak tile).
      this.throughputBuffer = state.throughputBuffer
        .filter((p) => p.timestamp > cutoff)
        .map((p) => ({
          ...p,
          parkedCount: (p as { parkedCount?: number }).parkedCount ?? 0,
        }));

      this.latestTotalCompleted = state.latestTotalCompleted;
      this.latestTotalFailed = state.latestTotalFailed;
    } catch (err) {
      logger.warn(
        { error: err },
        "Failed to restore persisted metrics state, starting fresh",
      );
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
      usedCpuUserMainThreadSeconds:
        parseFloat(get("used_cpu_user_main_thread")) || 0,
      usedCpuSysMainThreadSeconds:
        parseFloat(get("used_cpu_sys_main_thread")) || 0,
    };
  }

  private pruneStaleCounters(): void {
    const activeKeys = new Set(this.groupQueueNames);
    for (const key of this.prevCompleted.keys()) {
      if (key.startsWith(JOB_NAME_COUNTER_PREFIX)) continue;
      if (!activeKeys.has(key)) {
        this.prevCompleted.delete(key);
        this.prevFailed.delete(key);
      }
    }
  }

  /** Scans live queue state and Redis info in parallel, and caches both as
   * the collector's latest snapshot. */
  private async scanQueuesAndRedisInfo(): Promise<{
    queues: QueueInfo[];
    redisInfo: RedisInfo;
  }> {
    const [queues, redisInfo] = await Promise.all([
      this.queueRepo.scanQueues({ queueNames: this.groupQueueNames }),
      this.getRedisInfo(),
    ]);
    this.latestQueues = queues;
    this.latestRedisInfo = redisInfo;
    return { queues, redisInfo };
  }

  /** Derives this cycle's Redis engine-CPU percent from the previous sample
   * and stores the new sample for next cycle. */
  private updateRedisEngineCpu(redisInfo: RedisInfo): void {
    const sampledAt = Date.now();
    this.currentRedisEngineCpuPercent = computeEngineCpuPercent({
      prev: this.prevRedisCpu,
      nextUserSec: redisInfo.usedCpuUserMainThreadSeconds,
      nextSysSec: redisInfo.usedCpuSysMainThreadSeconds,
      nextSampledAt: sampledAt,
    });
    this.prevRedisCpu = {
      userSec: redisInfo.usedCpuUserMainThreadSeconds,
      sysSec: redisInfo.usedCpuSysMainThreadSeconds,
      sampledAt,
    };
  }

  private async refreshPausedKeys(): Promise<void> {
    const pausedPipeline = this.redis.pipeline();
    for (const name of this.groupQueueNames) {
      pausedPipeline.smembers(`${name}:gq:paused-jobs`);
    }
    const pausedResults = await pausedPipeline.exec();
    this.currentPausedKeys = Array.from(
      flattenPausedKeyResults(pausedResults ?? []),
    );
  }

  /** Records every pipeline/type/name path seen this cycle into the known-
   * pipelines sorted set, and prunes entries older than 24h. No-op when
   * nothing was discovered. */
  private async recordDiscoveredPipelinePaths(
    queues: QueueInfo[],
  ): Promise<void> {
    const discoveredPaths = discoverPipelinePaths(queues);
    if (discoveredPaths.size === 0) return;

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

  private async refreshKnownPipelinePaths(): Promise<void> {
    const knownPaths = await this.redis.zrange(KNOWN_PIPELINES_KEY, 0, 9999);
    this.knownPipelinePaths = knownPaths;
  }

  /** Applies this cycle's completed/failed/ingested rates and rolls them
   * into the running peaks. No-op before a baseline exists or when no time
   * has elapsed (guards a divide-by-zero). */
  private applyThroughputRates({
    totalInFlight,
    newCompleted,
    newFailed,
    elapsed,
  }: {
    totalInFlight: number;
    newCompleted: number;
    newFailed: number;
    elapsed: number;
  }): void {
    if (!this.hasBaseline || elapsed <= 0) return;

    this.currentCompletedPerSec =
      Math.round((newCompleted / elapsed) * 100) / 100;
    this.currentFailedPerSec = Math.round((newFailed / elapsed) * 100) / 100;

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

  private pushThroughputPoint({
    now,
    totalPending,
    totalBlockedCount,
    totalParkedCount,
  }: {
    now: number;
    totalPending: number;
    totalBlockedCount: number;
    totalParkedCount: number;
  }): void {
    this.throughputBuffer.push({
      timestamp: now,
      ingestedPerSec: this.currentIngestedPerSec,
      completedPerSec: this.currentCompletedPerSec,
      failedPerSec: this.currentFailedPerSec,
      pendingCount: totalPending,
      blockedCount: totalBlockedCount,
      parkedCount: totalParkedCount,
    });

    if (this.throughputBuffer.length > THROUGHPUT_BUFFER_SIZE) {
      this.throughputBuffer.shift();
    }
  }

  private updateProcessCpuPercent(now: number): void {
    const cpuNow = process.cpuUsage(this.lastCpuUsage);
    const cpuElapsed = now - this.lastCpuTime;
    if (cpuElapsed > 0) {
      const totalCpuUs = cpuNow.user + cpuNow.system;
      this.currentCpuPercent = (totalCpuUs / 1000 / cpuElapsed) * 100;
    }
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = now;
  }

  async collect(): Promise<void> {
    if (this.isCollecting) return;
    this.isCollecting = true;
    try {
      const { queues, redisInfo } = await this.scanQueuesAndRedisInfo();
      this.updateRedisEngineCpu(redisInfo);
      await this.refreshPausedKeys();

      await this.recordDiscoveredPipelinePaths(queues);
      await this.refreshKnownPipelinePaths();

      const { totalPending, totalInFlight } = computeInFlightTotals(queues);

      const now = Date.now();
      const elapsed = (now - this.lastTimestamp) / 1000;

      const { newCompleted, newFailed } = await this.computeJobMetrics({
        queues,
        elapsed: this.hasBaseline ? elapsed : 0,
      });

      this.latestTotalCompleted += newCompleted;
      this.latestTotalFailed += newFailed;

      this.applyThroughputRates({
        totalInFlight,
        newCompleted,
        newFailed,
        elapsed,
      });

      this.lastTotalInFlight = totalInFlight;
      this.lastTimestamp = now;
      this.hasBaseline = true;

      const { totalBlockedCount, totalParkedCount } =
        computeBlockedParkedTotals(queues);

      this.pushThroughputPoint({
        now,
        totalPending,
        totalBlockedCount,
        totalParkedCount,
      });

      this.updateProcessCpuPercent(now);

      this.pruneStaleCounters();
      this.persistState().catch((err) => {
        logger.warn({ error: err }, "Failed to persist metrics state");
      });
    } catch (err) {
      logger.warn(
        { error: err },
        "Metrics collection failed, retrying next interval",
      );
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
    singleton.start().catch((err) => {
      logger.error({ error: err }, "Failed to start ops metrics collector");
    });
  }
  return singleton;
}
