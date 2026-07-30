import { EventEmitter } from "node:events";
import * as os from "node:os";
import { createLogger } from "@langwatch/observability";
import type { Cluster, Redis as IORedis } from "ioredis";
import {
  computeEngineCpuPercent,
  type RedisCpuSample,
} from "./redis-engine-cpu";
import type { QueueRepository } from "./repositories/queue.repository";
import type {
  DashboardData,
  ErrorCluster,
  LaneKindSummary,
  RedisInfo,
  ThroughputPoint,
} from "./types";

const logger = createLogger("langwatch:ops:metrics-collector");

const THROUGHPUT_BUFFER_SIZE = 900;
const METRICS_COLLECT_INTERVAL_MS = 2_000;
const DASHBOARD_BROADCAST_INTERVAL_MS = 2_000;
const REDIS_STATE_TTL_SECONDS = 3600;
const LANE_KIND_DISCOVERY_INTERVAL_MS = 10_000;
const BADGE_CACHE_TTL_MS = 5_000;

export const DASHBOARD_EVENT = "dashboard";

const REDIS_STATE_KEY = "ops:metrics:state";

/** Only the rolling history survives a restart; every other figure is a
 * fresh read of the lane keys. */
interface PersistedMetricsState {
  version: 4;
  savedAt: number;
  throughputHistory: ThroughputPoint[];
}

const EMPTY_REDIS_INFO: RedisInfo = {
  usedMemoryHuman: "?",
  peakMemoryHuman: "?",
  usedMemoryBytes: 0,
  peakMemoryBytes: 0,
  maxMemoryBytes: 0,
  connectedClients: 0,
  usedCpuUserMainThreadSeconds: 0,
  usedCpuSysMainThreadSeconds: 0,
};

/**
 * Samples what the dispatch plane leaves in Redis and broadcasts it to the ops
 * dashboard.
 *
 * Depth, lease and park state are lane keys, so they are read here. Throughput,
 * latency and failure rates are not in Redis at all: the plane reports those
 * through its `Metrics` port, which is scraped. Deriving them from the keyspace
 * would mean inventing counters nothing writes.
 */
export class OpsMetricsCollector {
  private readonly redis: IORedis | Cluster;
  private readonly queueRepo: QueueRepository;
  private readonly emitter = new EventEmitter();

  private laneKinds: string[] = [];
  private throughputHistory: ThroughputPoint[] = [];
  private latestLaneKinds: LaneKindSummary[] = [];
  private latestParkReasons: ErrorCluster[] = [];
  private latestRedisInfo: RedisInfo = { ...EMPTY_REDIS_INFO };
  private prevRedisCpu: RedisCpuSample | null = null;
  private currentRedisEngineCpuPercent: number | null = null;
  private lastCpuUsage = process.cpuUsage();
  private lastCpuTime = Date.now();
  private currentCpuPercent = 0;
  private isCollecting = false;
  private badgeCountsCache: {
    parkedCount: number;
    computedAt: Date;
  } | null = null;

  private collectInterval: ReturnType<typeof setInterval> | null = null;
  private discoveryInterval: ReturnType<typeof setInterval> | null = null;
  private broadcastInterval: ReturnType<typeof setInterval> | null = null;

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
    await this.discoverLaneKinds();
    // Kick off the first collect without blocking start(); the interval below
    // keeps collecting on schedule. Errors are caught inside collect().
    void this.collect();
    this.collectInterval = setInterval(
      () => this.collect(),
      METRICS_COLLECT_INTERVAL_MS,
    );
    this.discoveryInterval = setInterval(
      () => this.discoverLaneKinds(),
      LANE_KIND_DISCOVERY_INTERVAL_MS,
    );
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
    for (const interval of [
      this.collectInterval,
      this.discoveryInterval,
      this.broadcastInterval,
    ]) {
      if (interval) clearInterval(interval);
    }
    this.collectInterval = null;
    this.discoveryInterval = null;
    this.broadcastInterval = null;
    this.emitter.removeAllListeners();
  }

  async discoverLaneKinds(): Promise<void> {
    try {
      this.laneKinds = await this.queueRepo.discoverLaneKinds();
    } catch (err) {
      logger.warn({ error: err }, "Failed to discover lane kinds");
    }
  }

  /**
   * Cached because the global nav polls it on every page load, where a fresh
   * read per call would put the registry scan on the critical path.
   */
  getBadgeCounts(): { parkedCount: number; computedAt: Date } {
    const now = Date.now();
    if (
      this.badgeCountsCache &&
      now - this.badgeCountsCache.computedAt.getTime() < BADGE_CACHE_TTL_MS
    ) {
      return this.badgeCountsCache;
    }
    this.badgeCountsCache = {
      parkedCount: this.latestLaneKinds.reduce(
        (sum, kind) => sum + kind.parkedLaneCount,
        0,
      ),
      computedAt: new Date(now),
    };
    return this.badgeCountsCache;
  }

  getDashboardData(): DashboardData {
    const totalMemoryMb = os.totalmem() / (1024 * 1024);
    return {
      totalLanes: this.latestLaneKinds.reduce(
        (sum, kind) => sum + kind.laneCount,
        0,
      ),
      parkedLanes: this.latestLaneKinds.reduce(
        (sum, kind) => sum + kind.parkedLaneCount,
        0,
      ),
      leasedLanes: this.latestLaneKinds.reduce(
        (sum, kind) => sum + kind.leasedLaneCount,
        0,
      ),
      totalPendingJobs: this.latestLaneKinds.reduce(
        (sum, kind) => sum + kind.totalPendingJobs,
        0,
      ),
      redisMemoryUsedBytes: this.latestRedisInfo.usedMemoryBytes,
      redisMemoryPeakBytes: this.latestRedisInfo.peakMemoryBytes,
      redisMemoryMaxBytes: this.latestRedisInfo.maxMemoryBytes,
      redisConnectedClients: this.latestRedisInfo.connectedClients,
      redisEngineCpuPercent: this.currentRedisEngineCpuPercent,
      processCpuPercent: this.currentCpuPercent,
      processMemoryUsedMb: process.memoryUsage().rss / (1024 * 1024),
      processMemoryTotalMb: totalMemoryMb,
      throughputHistory: [...this.throughputHistory],
      laneKinds: [...this.latestLaneKinds],
      topParkReasons: [...this.latestParkReasons],
    };
  }

  async collect(): Promise<void> {
    if (this.isCollecting) return;
    this.isCollecting = true;
    try {
      const [kinds, parked, redisInfo] = await Promise.all([
        this.queueRepo.scanLaneKinds({
          laneKinds: this.laneKinds,
          topN: 0,
        }),
        this.queueRepo.getParkedSummary({ laneKinds: this.laneKinds }),
        this.getRedisInfo(),
      ]);

      this.latestLaneKinds = kinds.map(({ lanes: _lanes, ...summary }) => ({
        ...summary,
      }));
      this.latestParkReasons = parked.clusters;
      this.latestRedisInfo = redisInfo;

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
      this.sampleProcessCpu(sampledAt);

      this.throughputHistory.push({
        timestamp: sampledAt,
        pendingCount: this.latestLaneKinds.reduce(
          (sum, kind) => sum + kind.totalPendingJobs,
          0,
        ),
        parkedCount: this.latestLaneKinds.reduce(
          (sum, kind) => sum + kind.parkedLaneCount,
          0,
        ),
        leasedCount: this.latestLaneKinds.reduce(
          (sum, kind) => sum + kind.leasedLaneCount,
          0,
        ),
      });
      if (this.throughputHistory.length > THROUGHPUT_BUFFER_SIZE) {
        this.throughputHistory.splice(
          0,
          this.throughputHistory.length - THROUGHPUT_BUFFER_SIZE,
        );
      }

      await this.persistState();
    } catch (err) {
      logger.warn({ error: err }, "Ops metrics collection cycle failed");
    } finally {
      this.isCollecting = false;
    }
  }

  private sampleProcessCpu(now: number): void {
    const usage = process.cpuUsage(this.lastCpuUsage);
    const elapsedMs = now - this.lastCpuTime;
    if (elapsedMs > 0) {
      const cpuMs = (usage.user + usage.system) / 1000;
      this.currentCpuPercent = Math.round((cpuMs / elapsedMs) * 1000) / 10;
    }
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = now;
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

  private async restoreState(): Promise<void> {
    try {
      const raw = await this.redis.get(REDIS_STATE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw) as PersistedMetricsState;
      if (state.version !== 4) return;
      const cutoff =
        Date.now() - THROUGHPUT_BUFFER_SIZE * METRICS_COLLECT_INTERVAL_MS;
      this.throughputHistory = state.throughputHistory.filter(
        (point) => point.timestamp > cutoff,
      );
    } catch (err) {
      logger.warn(
        { error: err },
        "Failed to restore persisted metrics state, starting fresh",
      );
    }
  }

  private async persistState(): Promise<void> {
    const state: PersistedMetricsState = {
      version: 4,
      savedAt: Date.now(),
      throughputHistory: this.throughputHistory,
    };
    await this.redis.set(
      REDIS_STATE_KEY,
      JSON.stringify(state),
      "EX",
      REDIS_STATE_TTL_SECONDS,
    );
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
