import * as os from "node:os";
import { Queue } from "bullmq";
import type IORedis from "ioredis";
import type { DashboardData, PipelineNode, ThroughputPoint, QueueInfo } from "../../shared/types.ts";
import { THROUGHPUT_BUFFER_SIZE, METRICS_COLLECT_INTERVAL_MS } from "../../shared/constants.ts";
import { scanGroupQueues } from "./groupQueueScanner.ts";
import { getRedisInfo } from "./redis.ts";

export class MetricsCollector {
  private redis: IORedis;
  private groupQueueNames: string[];
  private throughputBuffer: ThroughputPoint[] = [];
  private lastTotalInFlight = 0;
  private lastTotalFailed = 0;
  private lastTimestamp = Date.now();
  private hasBaseline = false;
  private currentStagedPerSec = 0;
  private currentCompletedPerSec = 0;
  private currentFailedPerSec = 0;
  private latestTotalCompleted = 0;
  private latestTotalFailed = 0;
  private latestQueues: QueueInfo[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastCpuUsage = process.cpuUsage();
  private lastCpuTime = Date.now();
  private currentCpuPercent = 0;
  private queueCache = new Map<string, Queue>();

  constructor(redis: IORedis, groupQueueNames: string[]) {
    this.redis = redis;
    this.groupQueueNames = groupQueueNames;
  }

  start(): void {
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

  async getDashboardData(): Promise<DashboardData> {
    const queues = this.latestQueues;
    const redisInfo = await getRedisInfo(this.redis);

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
    };
  }

  private getQueue(name: string): Queue {
    let q = this.queueCache.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.redis });
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

  private async collect(): Promise<void> {
    try {
      const queues = await scanGroupQueues(this.redis, this.groupQueueNames);
      this.latestQueues = queues;

      let totalPending = 0;
      for (const q of queues) {
        totalPending += q.totalPendingJobs;
      }

      // Collect BullMQ counts from all queues — in parallel
      const countPromises = this.groupQueueNames.map(async (name) => {
        try {
          const q = this.getQueue(name);
          const counts = await q.getJobCounts();
          return {
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
          };
        } catch {
          return { waiting: 0, active: 0, completed: 0, failed: 0 };
        }
      });
      const countResults = await Promise.all(countPromises);

      let totalWaiting = 0;
      let totalActive = 0;
      let totalCompleted = 0;
      let totalFailed = 0;
      for (const r of countResults) {
        totalWaiting += r.waiting;
        totalActive += r.active;
        totalCompleted += r.completed;
        totalFailed += r.failed;
      }
      this.latestTotalCompleted = totalCompleted;
      this.latestTotalFailed = totalFailed;

      // totalInFlight = staging pending + BullMQ waiting + BullMQ active
      // This metric is unaffected by dispatching (pending→waiting) since the
      // terms cancel. It only changes from new staging (increase) or
      // completion/removal (decrease).
      const totalInFlight = totalPending + totalWaiting + totalActive;

      const now = Date.now();
      const elapsed = (now - this.lastTimestamp) / 1000;

      if (this.hasBaseline && elapsed > 0) {
        const failedDelta = Math.max(0, totalFailed - this.lastTotalFailed);
        this.currentFailedPerSec = Math.round((failedDelta / elapsed) * 100) / 100;

        // inFlightDelta + failedDelta = newlyStaged - newlyCompleted
        // Positive → staging dominates, Negative → completions dominate
        const netDelta = (totalInFlight - this.lastTotalInFlight) + failedDelta;
        this.currentStagedPerSec = Math.round((Math.max(0, netDelta) / elapsed) * 100) / 100;
        this.currentCompletedPerSec = Math.round((Math.max(0, -netDelta) / elapsed) * 100) / 100;
      }

      this.lastTotalInFlight = totalInFlight;
      this.lastTotalFailed = totalFailed;
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
    } catch (err) {
      console.error("Metrics collection error:", err);
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
