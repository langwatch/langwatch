// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { KillSwitchLockRepository } from "../kill-switch-lock.repository.ts";

/** The lock twin: work on one key queues behind each other in this process. */
export class MemoryKillSwitchLockRepository extends KillSwitchLockRepository {
  private readonly tails = new Map<string, Promise<unknown>>();

  static create(): MemoryKillSwitchLockRepository {
    return new MemoryKillSwitchLockRepository();
  }

  async withLock<T>({ key, run }: { key: string; run: () => Promise<T> }): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const running = previous.then(run, run);
    const tail = running.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await running;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
