import type { ReplayHistoryEntry, ReplayStatus } from "@langwatch/ops-contract";
import { ReplayRepository } from "../replay.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

const HISTORY_LIMIT = 20;

/**
 * A replay run's state in memory: the same status, lock and history the Redis
 * rows hold, so a process with no Redis still answers the operator surface.
 */
export class MemoryReplayRepository extends ReplayRepository {
  static create({ store }: { store: MemoryOpsStore }): MemoryReplayRepository {
    return new MemoryReplayRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async getStatus(): Promise<ReplayStatus> {
    return { ...this.store.replayStatus };
  }

  async writeStatus({ status }: { status: ReplayStatus }): Promise<void> {
    this.store.replayStatus = { ...status };
  }

  async acquireLock({ runId }: { runId: string; ttlSeconds: number }): Promise<boolean> {
    if (this.store.replayLockHolder !== null) return false;
    this.store.replayLockHolder = runId;

    return true;
  }

  async refreshLock({ runId }: { runId: string; ttlSeconds: number }): Promise<boolean> {
    return this.store.replayLockHolder === runId;
  }

  async releaseLock({ runId }: { runId: string }): Promise<void> {
    if (this.store.replayLockHolder === runId) this.store.replayLockHolder = null;
  }

  async tryGetLockHolder(): Promise<string | null> {
    return this.store.replayLockHolder;
  }

  async isCancelled(): Promise<boolean> {
    return this.store.replayCancelled;
  }

  async setCancelled(): Promise<void> {
    this.store.replayCancelled = true;
  }

  async clearCancelFlag(): Promise<void> {
    this.store.replayCancelled = false;
  }

  async pushToHistory({ entry }: { entry: ReplayHistoryEntry }): Promise<void> {
    this.store.replayHistory.unshift(entry);
    this.store.replayHistory.splice(HISTORY_LIMIT);
  }

  async getHistory(): Promise<ReplayHistoryEntry[]> {
    return [...this.store.replayHistory];
  }
}
