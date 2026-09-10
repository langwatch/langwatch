/**
 * The accumulators one collector cycle folds into: the rolling throughput history, the current and
 * peak rates, and the counters a rate is derived from. Held apart from the scan so the fleet's
 * persisted copy, the dashboard view and the publication all read one object rather than a class.
 */

import { createLogger } from "@langwatch/observability";
import type {
  DashboardData,
  JobNameMetrics,
  QueueInfo,
  RedisInfo,
  ThroughputPoint,
} from "@langwatch/ops-contract";
import type { RedisCpuSample } from "../rules/ops-redis-engine-cpu.rules.ts";
import type { OpsMetricsRepository } from "../repositories/observe/ops-metrics.repository.ts";
import { nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:ops:metrics-window");

/** How many throughput points the rolling history keeps. */
export const THROUGHPUT_BUFFER_SIZE = 900;

/** How often a cycle samples, which is what a history point spans. */
export const METRICS_COLLECT_INTERVAL_MS = 2_000;

const REDIS_STATE_TTL_SECONDS = 3600;

/** Prefix distinguishing a per-job-name counter key from a queue's own. */
export const JOB_NAME_COUNTER_PREFIX = "jn:";

export interface PersistedMetricsState {
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

/**
 * Raw `__jobType` values become the projection-kind node names the health join looks up: folds enqueue as `projection`, maps
 * as `handler`, state projections as `stateProjection`. Filing `handler` under `fold` (as this did until #7322) left every map
 * row permanently dark — the join looked under `map`, which the tree never produced.
 */
export interface PeakBucket {
  completedPerSec: number;
  failedPerSec: number;
  latencyP50Ms: number;
  latencyP99Ms: number;
}

/**
 * One collector's live accumulators, folded with the fleet's persisted copy on takeover. Only the
 * pod holding the snapshot lease scans and publishes (ADR-090), and readers read the artifacts it
 * persists, so tabs served by different pods cannot disagree.
 */
export class OpsMetricsWindowService {
  /** An all-zero phase rollup, the shape every phase-derived figure starts from. */
  static emptyPhases(): DashboardData["phases"] {
    return {
      commands: { ...EMPTY_PHASE },
      projections: { ...EMPTY_PHASE },
      reactions: { ...EMPTY_PHASE },
    };
  }

  /** Field-wise max, so neither side of a handover loses a peak it observed. */
  static mergePeakBucket(mine: PeakBucket | undefined, theirs: PeakBucket): PeakBucket {
    if (!mine) {
      return { ...theirs };
    }

    return {
      completedPerSec: Math.max(mine.completedPerSec, theirs.completedPerSec),
      failedPerSec: Math.max(mine.failedPerSec, theirs.failedPerSec),
      latencyP50Ms: Math.max(mine.latencyP50Ms, theirs.latencyP50Ms),
      latencyP99Ms: Math.max(mine.latencyP99Ms, theirs.latencyP99Ms),
    };
  }

  /** Union two rolling histories by timestamp, newest window kept. */
  static mergeThroughput({
    mine,
    theirs,
  }: {
    mine: ThroughputPoint[];
    theirs: ThroughputPoint[];
  }): ThroughputPoint[] {
    const byTimestamp = new Map<number, ThroughputPoint>();
    for (const point of mine) {
      byTimestamp.set(point.timestamp, point);
    }

    for (const point of theirs) {
      byTimestamp.set(point.timestamp, point);
    }

    const cutoff =
      nowInstant().epochMilliseconds - THROUGHPUT_BUFFER_SIZE * METRICS_COLLECT_INTERVAL_MS;

    return Array.from(byTimestamp.values())
      .filter((point) => point.timestamp > cutoff)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-THROUGHPUT_BUFFER_SIZE);
  }

  throughputBuffer: ThroughputPoint[] = [];
  lastTotalInFlight = 0;
  lastTimestamp = nowInstant().epochMilliseconds;
  hasBaseline = false;
  currentIngestedPerSec = 0;
  currentCompletedPerSec = 0;
  currentFailedPerSec = 0;
  currentPhases: DashboardData["phases"] = OpsMetricsWindowService.emptyPhases();
  currentLatencyP50Ms = 0;
  currentLatencyP99Ms = 0;
  peakCompletedPerSec = 0;
  peakFailedPerSec = 0;
  peakIngestedPerSec = 0;
  peakLatencyP50Ms = 0;
  peakLatencyP99Ms = 0;
  peakPhases: Record<
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
  latestTotalCompleted = 0;
  latestTotalFailed = 0;
  latestQueues: QueueInfo[] = [];
  latestRedisInfo: RedisInfo = {
    usedMemoryHuman: "?",
    peakMemoryHuman: "?",
    usedMemoryBytes: 0,
    peakMemoryBytes: 0,
    maxMemoryBytes: 0,
    connectedClients: 0,
    usedCpuUserMainThreadSeconds: 0,
    usedCpuSysMainThreadSeconds: 0,
  };
  prevRedisCpu: RedisCpuSample | null = null;
  currentRedisEngineCpuPercent: number | null = null;
  lastCpuUsage = process.cpuUsage();
  lastCpuTime = nowInstant().epochMilliseconds;
  currentCpuPercent = 0;
  peakJobNames = new Map<
    string,
    {
      completedPerSec: number;
      failedPerSec: number;
      latencyP50Ms: number;
      latencyP99Ms: number;
    }
  >();
  currentJobNameMetrics: JobNameMetrics[] = [];
  currentPausedKeys: string[] = [];
  latestPendingDrift = 0;
  knownPipelinePaths: string[] = [];
  prevCompleted = new Map<string, number>();
  prevFailed = new Map<string, number>();

  static create(): OpsMetricsWindowService {
    return new OpsMetricsWindowService();
  }

  async restore(metrics: OpsMetricsRepository): Promise<void> {
    try {
      const raw = await metrics.tryReadPersistedState();
      if (!raw) {
        return;
      }

      const state: PersistedMetricsState = JSON.parse(raw);
      if (state.version !== 3) {
        return;
      }

      this.peakCompletedPerSec = Math.max(this.peakCompletedPerSec, state.peakCompletedPerSec);
      this.peakFailedPerSec = Math.max(this.peakFailedPerSec, state.peakFailedPerSec);
      this.peakIngestedPerSec = Math.max(this.peakIngestedPerSec, state.peakIngestedPerSec);
      this.peakLatencyP50Ms = Math.max(this.peakLatencyP50Ms, state.peakLatencyP50Ms);
      this.peakLatencyP99Ms = Math.max(this.peakLatencyP99Ms, state.peakLatencyP99Ms);

      for (const [key, value] of Object.entries(state.peakPhases)) {
        this.peakPhases[key] = OpsMetricsWindowService.mergePeakBucket(this.peakPhases[key], value);
      }

      for (const [key, value] of state.peakJobNames) {
        this.peakJobNames.set(
          key,
          OpsMetricsWindowService.mergePeakBucket(this.peakJobNames.get(key), value),
        );
      }

      // Backfill parkedCount on points persisted before the Parked series
      // existed, so the chart never reads undefined/NaN for old history. The
      // state version is intentionally not bumped: this keeps the rolling
      // history AND the accumulated peaks across the deploy (a bump would zero
      // them, including the freshly-added Completed/s peak tile).
      this.throughputBuffer = OpsMetricsWindowService.mergeThroughput({
        mine: this.throughputBuffer,
        theirs: state.throughputBuffer.map((p) => ({
          ...p,
          parkedCount: (p as { parkedCount?: number }).parkedCount ?? 0,
        })),
      });

      // Monotonic lifetime totals: the larger is the later reading.
      this.latestTotalCompleted = Math.max(this.latestTotalCompleted, state.latestTotalCompleted);
      this.latestTotalFailed = Math.max(this.latestTotalFailed, state.latestTotalFailed);
    } catch (err) {
      logger.warn({ error: err }, "Failed to restore persisted metrics state, starting fresh");
    }
  }

  /** Drops the counters of queues that no longer exist, keeping the per-job-name ones. */
  pruneStaleCounters(activeQueueNames: string[]): void {
    const activeKeys = new Set(activeQueueNames);
    for (const key of this.prevCompleted.keys()) {
      if (key.startsWith(JOB_NAME_COUNTER_PREFIX)) {
        continue;
      }

      if (!activeKeys.has(key)) {
        this.prevCompleted.delete(key);
        this.prevFailed.delete(key);
      }
    }
  }

  async persist(metrics: OpsMetricsRepository): Promise<void> {
    const state: PersistedMetricsState = {
      version: 3,
      savedAt: nowInstant().epochMilliseconds,
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
    await metrics.writePersistedState({
      state: JSON.stringify(state),
      ttlSeconds: REDIS_STATE_TTL_SECONDS,
    });
  }
}
