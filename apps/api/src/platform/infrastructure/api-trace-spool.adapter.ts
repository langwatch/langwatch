import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import type { StoredObjectStorageDestination } from "@langwatch/stored-object-contract";
import type { StoredObjectStorageRuntimeAdapter } from "@langwatch/stored-object-server";
import { TraceSpoolStoragePort, type TraceSpoolObjectStore } from "@langwatch/trace-server";

export type ApiTraceSpoolStorageOptions = {
  runtime: StoredObjectStorageRuntimeAdapter;
  aws: AwsClientProcessRuntime;
  /** The operator's `AZURE_BLOB_SPOOL_RETENTION_CONFIRMED`, read once at boot. */
  azureRetentionConfirmed: boolean;
};

/**
 * The trace spool over this process's stored-objects runtime, resolved per
 * project so a BYOC tenant writes into its own bucket. The worker's twin.
 */
// NO v1 TRANSPORT: this process is the WRITE side, and only ever mints v2.
export class ApiTraceSpoolStorageAdapter extends TraceSpoolStoragePort {
  static create(options: ApiTraceSpoolStorageOptions): ApiTraceSpoolStorageAdapter {
    return new ApiTraceSpoolStorageAdapter(options);
  }

  private constructor(private readonly options: ApiTraceSpoolStorageOptions) {
    super();
  }

  get azureRetentionConfirmed(): boolean {
    return this.options.azureRetentionConfirmed;
  }

  objectStoreFor(projectId: string): TraceSpoolObjectStore {
    return this.project(projectId).objectStore;
  }

  resolveDestination(projectId: string): Promise<StoredObjectStorageDestination> {
    return this.project(projectId).resolveDestination();
  }

  private project(projectId: string) {
    return this.options.runtime.forProject(projectId, this.options.aws);
  }
}
