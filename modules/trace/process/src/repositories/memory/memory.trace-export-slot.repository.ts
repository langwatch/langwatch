import { nowInstant } from "@langwatch/time";

import { TraceExportSlotRepository } from "../trace-export-slot.repository.ts";

/** The Redis slots' memory twin: a claim holds its key in this process until freed or expired. */
export class MemoryTraceExportSlotRepository extends TraceExportSlotRepository {
  static create(): MemoryTraceExportSlotRepository {
    return new MemoryTraceExportSlotRepository();
  }

  readonly #expiries = new Map<string, number>();

  private constructor() {
    super();
  }

  claim(key: string, _value: string, expirySeconds: number): Promise<boolean> {
    const now = nowInstant().epochMilliseconds;
    const held = this.#expiries.get(key);
    if (held !== undefined && held > now) return Promise.resolve(false);
    this.#expiries.set(key, now + expirySeconds * 1000);
    return Promise.resolve(true);
  }

  del(key: string): Promise<number> {
    return Promise.resolve(this.#expiries.delete(key) ? 1 : 0);
  }
}
