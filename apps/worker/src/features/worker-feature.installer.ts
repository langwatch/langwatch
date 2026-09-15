/** Releases what a feature's `install()` acquired; runs in reverse install order. */
export type WorkerFeatureCloser = () => Promise<void>;

/** A feature-owned consumer/process-manager contribution to the worker graph. */
export interface WorkerFeatureInstaller {
  readonly name: string;

  install(): Promise<WorkerFeatureCloser | undefined>;
}
