// The vocabulary is the Ops contract's: one definition of what a replay is,
// shared by the repository here and by the port the operator transport calls.
import type { ReplayHistoryEntry, ReplayStatus } from "@langwatch/ops-contract";

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
  tryGetLockHolder(): Promise<string | null>;

  isCancelled(): Promise<boolean>;
  setCancelled(params: { ttlSeconds: number }): Promise<void>;
  clearCancelFlag(): Promise<void>;

  pushToHistory(params: { entry: ReplayHistoryEntry }): Promise<void>;
  getHistory(): Promise<ReplayHistoryEntry[]>;
}
