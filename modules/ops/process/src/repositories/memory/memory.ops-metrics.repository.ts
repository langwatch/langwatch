import {
  OpsMetricsRepository,
  type OpsLatencyHistograms,
  type OpsPersistedStateRead,
  type OpsQueueTotals,
} from "../ops-metrics.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

/** How many pipeline paths a read answers, as the stored sorted set is read. */
const KNOWN_PIPELINE_PATH_LIMIT = 10_000;

/**
 * The collector's own state in memory: its persisted window and the pipeline paths it saw.
 * A memory process keeps no queue counters beside its queues, so every queue reading is empty.
 */
export class MemoryOpsMetricsRepository extends OpsMetricsRepository {
  static create({ store }: { store: MemoryOpsStore }): MemoryOpsMetricsRepository {
    return new MemoryOpsMetricsRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async readLatencyHistograms({
    queueNames,
  }: {
    queueNames: string[];
    nowMs: number;
  }): Promise<OpsLatencyHistograms> {
    return {
      minute: [],
      hourByQueue: queueNames.map(() => []),
      allTime: queueNames.map(() => ({})),
    };
  }

  async readQueueTotals({ queueNames }: { queueNames: string[] }): Promise<OpsQueueTotals[]> {
    return queueNames.map(() => ({ completed: 0, failed: 0 }));
  }

  async readLatencySamplesMs(_input: { queueNames: string[] }): Promise<number[]> {
    return [];
  }

  async readJobNameTotals({
    jobNames,
  }: {
    queueNames: string[];
    jobNames: string[];
  }): Promise<Map<string, OpsQueueTotals>> {
    return new Map(jobNames.map((jobName) => [jobName, { completed: 0, failed: 0 }]));
  }

  async readPausedJobKeys(_input: { queueNames: string[] }): Promise<string[]> {
    return [];
  }

  async readPersistedState(): Promise<OpsPersistedStateRead> {
    const raw = this.store.metricsState;
    return raw ? { kind: "hit", raw } : { kind: "miss" };
  }

  async writePersistedState({ state }: { state: string; ttlSeconds: number }): Promise<void> {
    this.store.metricsState = state;
  }

  async readServerInfo(): Promise<string> {
    return "";
  }

  async recordKnownPipelinePaths({
    paths,
    at,
    dropBefore,
  }: {
    paths: string[];
    at: number;
    dropBefore: number;
  }): Promise<void> {
    if (paths.length === 0) return;
    for (const path of paths) this.store.knownPipelinePaths.set(path, at);
    for (const [path, seenAt] of this.store.knownPipelinePaths) {
      if (seenAt <= dropBefore) this.store.knownPipelinePaths.delete(path);
    }
  }

  async readKnownPipelinePaths(): Promise<string[]> {
    return [...this.store.knownPipelinePaths.entries()]
      .toSorted(([, left], [, right]) => left - right)
      .slice(0, KNOWN_PIPELINE_PATH_LIMIT)
      .map(([path]) => path);
  }
}
