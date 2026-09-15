import { AnomalyRateTrackerRepository } from "../observe/anomaly.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

/**
 * The ingest counters in memory: the same minute series and cached baseline
 * the Redis rows hold, so the detector's tick answers without Redis.
 */
export class MemoryAnomalyRateTrackerRepository extends AnomalyRateTrackerRepository {
  static create({
    store,
    now = Date.now,
  }: {
    store: MemoryOpsStore;
    now?: () => number;
  }): MemoryAnomalyRateTrackerRepository {
    return new MemoryAnomalyRateTrackerRepository(store, now);
  }

  private constructor(
    private readonly store: MemoryOpsStore,
    private readonly now: () => number,
  ) {
    super();
  }

  /** One tenant's ingest count for the epoch minute the clock is in. */
  async record(tenantId: string, count = 1): Promise<void> {
    if (!tenantId) return;
    const minutes = this.store.tenantRateMinutes.get(tenantId) ?? new Map<number, number>();
    const minute = Math.floor(this.now() / 60_000);
    minutes.set(minute, (minutes.get(minute) ?? 0) + count);
    this.store.tenantRateMinutes.set(tenantId, minutes);
  }

  async listActiveTenants(): Promise<string[]> {
    return [...this.store.tenantRateMinutes.keys()];
  }

  async currentWindowCount(tenantId: string, windowSeconds: number): Promise<number> {
    return this.#series(tenantId, windowSeconds).reduce((total, count) => total + count, 0);
  }

  async findCachedBaseline(tenantId: string): Promise<number | null> {
    return this.store.rateBaselines.get(tenantId) ?? null;
  }

  async perMinuteSeries(tenantId: string, lookbackSeconds: number): Promise<number[]> {
    return this.#series(tenantId, lookbackSeconds);
  }

  async setCachedBaseline({
    tenantId,
    baseline,
  }: {
    tenantId: string;
    baseline: number;
    ttlSeconds?: number | undefined;
  }): Promise<void> {
    this.store.rateBaselines.set(tenantId, baseline);
  }

  /** The counts for each minute in the window, oldest first, zeroes included. */
  #series(tenantId: string, windowSeconds: number): number[] {
    const minutes = this.store.tenantRateMinutes.get(tenantId);
    if (!minutes) return [];

    const latest = Math.floor(this.now() / 60_000);
    const span = Math.max(1, Math.ceil(windowSeconds / 60));

    return Array.from({ length: span }, (_unused, offset) => minutes.get(latest - span + 1 + offset) ?? 0);
  }
}
