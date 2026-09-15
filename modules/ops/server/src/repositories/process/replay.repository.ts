// The vocabulary is the Ops contract's: one definition of what a replay is,
// shared by the repository here and by the port the operator transport calls.
import type { ReplayHistoryEntry, ReplayStatus } from "@langwatch/ops-contract";

export abstract class ReplayRepository {
  abstract getStatus(): Promise<ReplayStatus>;
  abstract writeStatus(params: { status: ReplayStatus }): Promise<void>;

  abstract acquireLock(params: { runId: string; ttlSeconds: number }): Promise<boolean>;
  /**
   * Extend the lock's TTL, but only while `runId` still holds it. Long
   * replays heartbeat this per batch — without it the lock expires mid-run
   * and progress updates silently stop.
   */
  abstract refreshLock(params: { runId: string; ttlSeconds: number }): Promise<boolean>;
  abstract releaseLock(params: { runId: string }): Promise<void>;
  abstract tryGetLockHolder(): Promise<string | null>;

  abstract isCancelled(): Promise<boolean>;
  abstract setCancelled(params: { ttlSeconds: number }): Promise<void>;
  abstract clearCancelFlag(): Promise<void>;

  abstract pushToHistory(params: { entry: ReplayHistoryEntry }): Promise<void>;
  abstract getHistory(): Promise<ReplayHistoryEntry[]>;
}
