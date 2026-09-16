import type { Readable } from "node:stream";
import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import {
  mintStoredObjectUri,
  type StoredObjectStorageDestination,
} from "@langwatch/stored-object-contract";
import type { StoredObjectStorageRuntimeAdapter } from "@langwatch/stored-object-server";
import {
  type TraceSpoolLegacyObject,
  type TraceSpoolStorage,
  type TraceSpoolObjectStore,
} from "@langwatch/trace-server";

export type WorkerTraceSpoolStorageOptions = {
  runtime: StoredObjectStorageRuntimeAdapter;
  aws: AwsClientProcessRuntime;
  /**
   * The operator's assertion that the Azure container has the orphan-reaping
   * lifecycle rule, read once at boot from `AZURE_BLOB_SPOOL_RETENTION_CONFIRMED`.
   */
  azureRetentionConfirmed: boolean;
};

/**
 * The trace spool over this process's stored-objects runtime. Exactly what
 * the application's `defaultSpoolStorage` is: the same registry every other
 * byte-writing surface uses, resolved per project so BYOC writes to its own bucket.
 */
export class WorkerTraceSpoolStorageAdapter implements TraceSpoolStorage {
  static create(options: WorkerTraceSpoolStorageOptions): WorkerTraceSpoolStorageAdapter {
    return new WorkerTraceSpoolStorageAdapter(options);
  }

  private constructor(private readonly options: WorkerTraceSpoolStorageOptions) {}

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

/**
 * v1 spool read through stored-objects runtime: key is resolved to URI against the project's
 * destination. Non-S3 destinations refuse by name (v1 format predates multi-destination support).
 */
export class WorkerTraceSpoolLegacyObjectAdapter implements TraceSpoolLegacyObject {
  static create(options: {
    runtime: StoredObjectStorageRuntimeAdapter;
    aws: AwsClientProcessRuntime;
  }): WorkerTraceSpoolLegacyObjectAdapter {
    return new WorkerTraceSpoolLegacyObjectAdapter(options.runtime, options.aws);
  }

  private constructor(
    private readonly runtime: StoredObjectStorageRuntimeAdapter,
    private readonly aws: AwsClientProcessRuntime,
  ) {}

  async read(input: { projectId: string; key: string }): Promise<Readable> {
    const { objectStore, uri } = await this.locate(input);
    return objectStore.get(uri);
  }

  async delete(input: { projectId: string; key: string }): Promise<void> {
    const { objectStore, uri } = await this.locate(input);
    await objectStore.delete(uri);
  }

  private async locate(input: {
    projectId: string;
    key: string;
  }): Promise<{ objectStore: TraceSpoolObjectStore; uri: string }> {
    const project = this.runtime.forProject(input.projectId, this.aws);
    const destination = await project.resolveDestination();
    if (destination.kind !== "s3") {
      throw new Error(
        `A v1 spool reference names an S3 object, but this project's storage destination is "${destination.kind}".`,
      );
    }
    return {
      objectStore: project.objectStore,
      uri: mintStoredObjectUri({ destination, objectPath: input.key }),
    };
  }
}
