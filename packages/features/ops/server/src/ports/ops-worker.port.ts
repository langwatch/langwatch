export interface OpsWorkerHandle {
  stop(): void | Promise<void>;
}

export interface UsageStatsWorkerConfig {
  disabled: boolean;
  installMethod: string;
  hostname: string | undefined;
  environment: string | undefined;
  now: () => Date;
}

/** Process controls for the complete Ops worker graph. */
export abstract class OpsWorkerPort {
  abstract tryStartAnomalyWorker(): OpsWorkerHandle | undefined;
  abstract tryStartUsageStatsWorker(): OpsWorkerHandle | undefined;
  /**
   * The fleet's queue-metrics writer. One process publishes the snapshot every other one reads, so
   * the handle's `stop` hands the lease back rather than letting the fleet wait out its TTL.
   */
  abstract tryStartQueueMetricsWriter(): OpsWorkerHandle | undefined;
}
