export abstract class WorkerFeatureHandlePort {
  abstract close(): Promise<void>;
}

/** A feature-owned consumer/process-manager contribution to the worker graph. */
export abstract class WorkerFeatureInstallerPort {
  abstract readonly name: string;

  abstract install(): Promise<WorkerFeatureHandlePort>;
}
