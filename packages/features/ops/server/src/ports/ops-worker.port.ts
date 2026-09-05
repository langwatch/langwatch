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
}
