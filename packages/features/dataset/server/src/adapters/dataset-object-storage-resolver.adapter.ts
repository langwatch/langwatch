/**
 * One backend per project, decided by a caller-supplied destination policy —
 * BYOC first, then this deployment's own backend choice — and an S3 client
 * built from the composing process's own AWS transport.
 *
 * This module owns none of the destination POLICY itself: any process
 * composing object storage (the worker's normalize job, a task's one-off
 * backfill) hands it the same decision its own general storage policy
 * already makes, through {@link DatasetStorageDestinationPort}, so a
 * dataset's chunks land where the rest of that project's objects do. Only the
 * backend KIND crosses that seam — bucket, endpoint and credentials stay this
 * module's own concern, resolved per project by {@link
 * DatasetObjectStorageS3ClientResolver} and (for Azure) the caller's own
 * `DatasetAzureConfigResolver`.
 */
import { S3Client } from "@aws-sdk/client-s3";
import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import { AzureDatasetStorageAdapter } from "./azure.dataset-storage.adapter";
import { LocalDatasetStorageAdapter } from "./local.dataset-storage.adapter";
import { S3DatasetStorageAdapter } from "./s3.dataset-storage.adapter";
import {
  DatasetAzureConfigResolver,
  DatasetS3ClientResolver,
  DatasetStorageResolver,
  type DatasetS3ClientLease,
  type DatasetStorage,
} from "../ports/dataset-storage.port";

/** One S3-compatible target: a bucket, and how to reach and authenticate to it. */
export type DatasetS3Target = Readonly<{
  bucket: string;
  endpoint?: string;
  region?: string;
  credentials?: Readonly<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  }>;
}>;

/** Where one project's dataset content lives — a decision made upstream of this module. */
export type DatasetStorageDestination =
  | { kind: "s3" }
  | { kind: "azure" }
  | { kind: "file"; root: string };

export abstract class DatasetStorageDestinationPort {
  abstract resolve(projectId: string): Promise<DatasetStorageDestination>;
}

/**
 * An S3 client for one project's dataset objects, built fresh per operation
 * from the process's own AWS transport. No client is retained across calls —
 * one normalize/backfill operation per dataset already serializes this, and a
 * per-operation client removes the lifecycle where a superseded client is
 * destroyed under an in-flight read.
 */
export class DatasetObjectStorageS3ClientResolver extends DatasetS3ClientResolver {
  constructor(
    private readonly aws: AwsClientProcessRuntime,
    private readonly lookupProjectTarget: (projectId: string) => Promise<DatasetS3Target | null>,
    private readonly globalS3: DatasetS3Target | undefined,
  ) {
    super();
  }

  async acquire(projectId: string): Promise<DatasetS3ClientLease> {
    const target = (await this.lookupProjectTarget(projectId)) ?? this.globalS3;
    if (!target?.bucket) {
      throw new Error(`No S3 bucket is configured for project ${projectId}`);
    }

    const s3Client = new S3Client({
      ...this.aws.build({
        ...(target.region === undefined ? {} : { region: target.region }),
        targetHost: target.endpoint ?? "s3.amazonaws.com",
        ...(target.endpoint ? { endpoint: target.endpoint } : {}),
        ...(target.credentials ? { staticCredentials: target.credentials } : {}),
      }),
      forcePathStyle: true,
    });

    return { s3Client, s3Bucket: target.bucket, release: () => s3Client.destroy() };
  }
}

/**
 * Resolves one project's `DatasetStorage` from a destination decision this
 * module does not make itself. `azureConfig` is optional: a process that
 * composes no Azure driver still builds successfully, and only refuses (by
 * name, from its own resolver) the moment a project's destination actually
 * decides `azure`.
 */
export class DatasetObjectStorageResolver extends DatasetStorageResolver {
  private azure: AzureDatasetStorageAdapter | undefined;
  private readonly s3: S3DatasetStorageAdapter;

  private constructor(
    private readonly destination: DatasetStorageDestinationPort,
    s3ClientResolver: DatasetS3ClientResolver,
    private readonly azureConfig: DatasetAzureConfigResolver | undefined,
  ) {
    super();
    this.s3 = S3DatasetStorageAdapter.create(s3ClientResolver);
  }

  static create(options: {
    destination: DatasetStorageDestinationPort;
    s3ClientResolver: DatasetS3ClientResolver;
    azureConfig?: DatasetAzureConfigResolver;
  }): DatasetObjectStorageResolver {
    return new DatasetObjectStorageResolver(
      options.destination,
      options.s3ClientResolver,
      options.azureConfig,
    );
  }

  async forProject(projectId: string): Promise<DatasetStorage> {
    const destination = await this.destination.resolve(projectId);

    if (destination.kind === "s3") return this.s3;

    if (destination.kind === "azure") {
      if (!this.azureConfig) {
        throw new Error(
          "Dataset object storage resolved an Azure destination, but this process composes no Azure driver.",
        );
      }
      this.azure ??= AzureDatasetStorageAdapter.create(this.azureConfig);
      return this.azure;
    }

    return LocalDatasetStorageAdapter.create(destination.root);
  }
}
