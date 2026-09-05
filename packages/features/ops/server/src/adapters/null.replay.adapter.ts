// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repositories implement the interface as intentional no-ops.

import { IDLE_STATUS, type ReplayHistoryEntry, type ReplayStatus } from "@langwatch/ops-contract";
import type { ReplayRepository } from "../repositories/replay.repository";

export class NullReplayAdapter implements ReplayRepository {
  static create(): NullReplayAdapter {
    return new NullReplayAdapter();
  }

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

  async tryGetLockHolder(): Promise<string | null> {
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
