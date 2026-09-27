import { nowInstant } from "@langwatch/time";

import { TraceExportSlotRepository } from "../trace-export-slot.repository.ts";

/** Export slots in process memory, expiring on the same clock the Redis TTL keeps. */
export class MemoryTraceExportSlotRepository extends TraceExportSlotRepository {
  static create(): MemoryTraceExportSlotRepository {
    return new MemoryTraceExportSlotRepository();
  }

  #held = new Map<string, number>();

  private constructor() {
    super();
  }

  async claim(key: string, _value: string, expirySeconds: number): Promise<boolean> {
    const now = nowInstant().epochMilliseconds;
    const expiresAt = this.#held.get(key);
    if (expiresAt !== undefined && expiresAt > now) return false;
    this.#held.set(key, now + expirySeconds * 1000);

    return true;
  }

  async del(key: string): Promise<number> {
    return this.#held.delete(key) ? 1 : 0;
  }
}
