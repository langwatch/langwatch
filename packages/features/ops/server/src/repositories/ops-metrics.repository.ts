/**
 * The counters, histograms and rolling state GroupQueue keeps beside its
 * queues, and the fleet's own persisted accumulators. Every method answers in
 * the collector's vocabulary rather than handing back a command result, so the
 * key shapes and the pipelining stay on the storage side.
 */
export type OpsLatencyHistograms = {
  /** Every queue's most recent 60 minute buckets. */
  minute: Array<Record<string, string>>;
  /** Per queue, that queue's most recent 168 hour buckets, newest first. */
  hourByQueue: Array<Array<Record<string, string>>>;
  /** One cumulative hash per queue. */
  allTime: Array<Record<string, string>>;
};

export type OpsQueueTotals = { completed: number; failed: number };

export abstract class OpsMetricsRepository {
  abstract readLatencyHistograms(input: {
    queueNames: string[];
    nowMs: number;
  }): Promise<OpsLatencyHistograms>;
  /** Lifetime completed/failed per queue, in the order the names were given. */
  abstract readQueueTotals(input: { queueNames: string[] }): Promise<OpsQueueTotals[]>;
  /** Every finite, non-negative completion latency sample the queues still hold. */
  abstract readLatencySamplesMs(input: { queueNames: string[] }): Promise<number[]>;
  /** Lifetime completed/failed per job name, summed across the queues. */
  abstract readJobNameTotals(input: {
    queueNames: string[];
    jobNames: string[];
  }): Promise<Map<string, OpsQueueTotals>>;
  abstract readPausedJobKeys(input: { queueNames: string[] }): Promise<string[]>;
  abstract readPersistedState(): Promise<string | null>;
  abstract writePersistedState(input: { state: string; ttlSeconds: number }): Promise<void>;
  /** The server's own INFO text, parsed by the caller. */
  abstract readServerInfo(): Promise<string>;
  /** Records the paths seen this cycle and drops the ones last seen before `dropBefore`. */
  abstract recordKnownPipelinePaths(input: {
    paths: string[];
    at: number;
    dropBefore: number;
  }): Promise<void>;
  abstract readKnownPipelinePaths(): Promise<string[]>;
}
