import type { Readable } from "node:stream";
import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import {
  mintStoredObjectUri,
  type StoredObjectStorageDestination,
} from "@langwatch/stored-object-contract";
import type { StoredObjectStorageRuntime } from "@langwatch/stored-object-server/storage";
import {
  TraceSpoolLegacyObjectPort,
  TraceSpoolStoragePort,
  type TraceSpoolObjectStore,
} from "@langwatch/trace-server";

export type WorkerTraceSpoolStorageOptions = {
  runtime: StoredObjectStorageRuntime;
  aws: AwsClientProcessRuntime;
  /**
   * The operator's assertion that the Azure container has the orphan-reaping
   * lifecycle rule, read once at boot from `AZURE_BLOB_SPOOL_RETENTION_CONFIRMED`.
   */
  azureRetentionConfirmed: boolean;
};

/**
 * The trace spool over this process's stored-objects runtime.
 *
 * Exactly what the application's `defaultSpoolStorage` is, built from the
 * substrate this process already holds: the same registry every other
 * byte-writing surface here uses, resolved per project so a BYOC tenant writes
 * into its own bucket.
 */
export class WorkerTraceSpoolStorageAdapter extends TraceSpoolStoragePort {
  static create(options: WorkerTraceSpoolStorageOptions): WorkerTraceSpoolStorageAdapter {
    return new WorkerTraceSpoolStorageAdapter(options);
  }

  private constructor(private readonly options: WorkerTraceSpoolStorageOptions) {
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

/**
 * The v1 spool read, expressed through the same stored-objects runtime.
 *
 * The application reaches a v1 key with a second, S3-only client factory
 * (`createS3Client`). This process has one storage path, so the key is turned
 * back into a URI against the project's own destination and read through the
 * registry — the same bucket, the same credentials, one resolution rule instead
 * of two.
 *
 * NON-S3 DESTINATIONS REFUSE BY NAME, and the refusal is not a limitation. The
 * v1 format predates the move onto the shared stored-objects layer, and that
 * move is what gave the spool Azure and filesystem destinations at all — so a
 * v1 key can only ever name an S3 object. Minting one against an Azure or file
 * destination would fabricate a location nothing ever wrote to.
 */
export class WorkerTraceSpoolLegacyObjectAdapter extends TraceSpoolLegacyObjectPort {
  static create(options: {
    runtime: StoredObjectStorageRuntime;
    aws: AwsClientProcessRuntime;
  }): WorkerTraceSpoolLegacyObjectAdapter {
    return new WorkerTraceSpoolLegacyObjectAdapter(options.runtime, options.aws);
  }

  private constructor(
    private readonly runtime: StoredObjectStorageRuntime,
    private readonly aws: AwsClientProcessRuntime,
  ) {
    super();
  }

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
