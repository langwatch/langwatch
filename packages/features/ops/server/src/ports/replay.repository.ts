// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repositories implement the interface as intentional no-ops.

// The vocabulary is the Ops contract's: one definition of what a replay is,
// shared by the repository here and by the port the operator transport calls.
import { IDLE_STATUS, type ReplayHistoryEntry, type ReplayStatus } from "@langwatch/ops-contract";

export interface ReplayRepository {
  getStatus(): Promise<ReplayStatus>;
  writeStatus(params: { status: ReplayStatus }): Promise<void>;

  acquireLock(params: { runId: string; ttlSeconds: number }): Promise<boolean>;
  /**
   * Extend the lock's TTL, but only while `runId` still holds it. Long
   * replays heartbeat this per batch — without it the lock expires mid-run
   * and progress updates silently stop.
   */
  refreshLock(params: { runId: string; ttlSeconds: number }): Promise<boolean>;
  releaseLock(params: { runId: string }): Promise<void>;
  getLockHolder(): Promise<string | null>;

  isCancelled(): Promise<boolean>;
  setCancelled(params: { ttlSeconds: number }): Promise<void>;
  clearCancelFlag(): Promise<void>;

  pushToHistory(params: { entry: ReplayHistoryEntry }): Promise<void>;
  getHistory(): Promise<ReplayHistoryEntry[]>;
}

export class NullReplayRepository implements ReplayRepository {
  async getStatus(): Promise<ReplayStatus> {
    return { ...IDLE_STATUS };
  }

  async writeStatus(): Promise<void> {}

  async acquireLock(): Promise<boolean> {
    return false;
  }

  async refreshLock(): Promise<boolean> {
    return false;
  }

  async releaseLock(): Promise<void> {}

  async getLockHolder(): Promise<string | null> {
    return null;
  }

  async isCancelled(): Promise<boolean> {
    return false;
  }

  async setCancelled(): Promise<void> {}

  async clearCancelFlag(): Promise<void> {}

  async pushToHistory(): Promise<void> {}

  async getHistory(): Promise<ReplayHistoryEntry[]> {
    return [];
  }
}
