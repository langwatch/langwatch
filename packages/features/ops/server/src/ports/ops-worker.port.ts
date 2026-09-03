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
  abstract startAnomalyWorker(): OpsWorkerHandle | undefined;
  abstract startUsageStatsWorker(): OpsWorkerHandle | undefined;
}
