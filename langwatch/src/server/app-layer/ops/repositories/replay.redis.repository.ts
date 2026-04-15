import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import {
  IDLE_STATUS,
  type ReplayRepository,
  type ReplayStatus,
  type ReplayHistoryEntry,
} from "./replay.repository";

const REPLAY_LOCK_KEY = "ops:replay:lock";
const REPLAY_STATUS_KEY = "ops:replay:status";
const REPLAY_CANCEL_KEY = "ops:replay:cancel";
const REPLAY_HISTORY_KEY = "ops:replay:history";
const REPLAY_STATUS_TTL_SECONDS = 7200;
const REPLAY_HISTORY_MAX = 50;

export class ReplayRedisRepository implements ReplayRepository {
  private readonly redis: IORedis | Cluster;

  constructor(redis: IORedis | Cluster) {
    this.redis = redis;
  }

  async getStatus(): Promise<ReplayStatus> {
    const raw = await this.redis.get(REPLAY_STATUS_KEY);
    if (!raw) return { ...IDLE_STATUS };
    try {
      return JSON.parse(raw) as ReplayStatus;
    } catch {
      return { ...IDLE_STATUS };
    }
  }

  async writeStatus(params: { status: ReplayStatus }): Promise<void> {
    await this.redis.set(
      REPLAY_STATUS_KEY,
      JSON.stringify(params.status),
      "EX",
      REPLAY_STATUS_TTL_SECONDS,
    );
  }

  async acquireLock(params: {
    runId: string;
    ttlSeconds: number;
  }): Promise<boolean> {
    const result = await this.redis.set(
      REPLAY_LOCK_KEY,
      params.runId,
      "EX",
      params.ttlSeconds,
      "NX",
    );
    return result !== null;
  }

  async releaseLock(params: { runId: string }): Promise<void> {
    const holder = await this.redis.get(REPLAY_LOCK_KEY);
    if (holder === params.runId) {
      await this.redis.del(REPLAY_LOCK_KEY);
    }
  }

  async getLockHolder(): Promise<string | null> {
    return this.redis.get(REPLAY_LOCK_KEY);
  }

  async isCancelled(): Promise<boolean> {
    const val = await this.redis.get(REPLAY_CANCEL_KEY);
    return val === "1";
  }

  async setCancelled(params: { ttlSeconds: number }): Promise<void> {
    await this.redis.set(REPLAY_CANCEL_KEY, "1", "EX", params.ttlSeconds);
  }

  async clearCancelFlag(): Promise<void> {
    await this.redis.del(REPLAY_CANCEL_KEY);
  }

  async pushToHistory(params: {
    entry: ReplayHistoryEntry;
  }): Promise<void> {
    await this.redis.lpush(
      REPLAY_HISTORY_KEY,
      JSON.stringify(params.entry),
    );
    await this.redis.ltrim(REPLAY_HISTORY_KEY, 0, REPLAY_HISTORY_MAX - 1);
  }

  async getHistory(): Promise<ReplayHistoryEntry[]> {
    const raw = await this.redis.lrange(REPLAY_HISTORY_KEY, 0, REPLAY_HISTORY_MAX - 1);
    const entries: ReplayHistoryEntry[] = [];
    for (const item of raw) {
      try {
        entries.push(JSON.parse(item) as ReplayHistoryEntry);
      } catch {
        // skip invalid entries
      }
    }
    return entries;
  }
}
