import { S3Client } from "@aws-sdk/client-s3";
import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import {
  DatasetNormalizationWorkerPort,
  type DatasetNormalizationSender,
  type DatasetNormalizePayload,
  type DatasetService,
} from "@langwatch/dataset-contract";
import {
  AzureDatasetStorageAdapter,
  DatasetAzureConfigResolver,
  PrismaDatasetContentRepository,
  DatasetNormalizationService,
  DatasetS3ClientResolver,
  DatasetStorageResolver,
  LocalDatasetStorageAdapter,
  PostgresDatasetAdapter,
  S3DatasetStorageAdapter,
  type DatasetAzureConfig,
  type DatasetContentDatabase,
  type DatasetS3ClientLease,
  type DatasetStorage,
} from "@langwatch/dataset-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { StoredObjectStorageRuntimeAdapter } from "@langwatch/stored-object-server";
import { createWorkerAzureBlobDriver } from "./worker-object-storage.composition";
import type { WorkerStorageConfig } from "../platform/config/worker.config";
import type {
  WorkerProjectS3SourcePort,
  WorkerProjectS3Target,
} from "../platform/infrastructure/worker-stored-object-storage.adapter";

/**
 * `job:datasetNormalize`, composed in this process. Azure reuses
 * `createWorkerAzureBlobDriver` rather than the general registry's factory,
 * since the finalize step needs `head()`.
 */
export function createWorkerDatasetNormalization(options: {
  database: DatasetContentDatabase;
  storage: WorkerDatasetObjectStorage;
}): DatasetNormalizationWorkerPort {
  return new WorkerDatasetNormalizationAdapter(
    DatasetNormalizationService.create({
      datasets: PrismaDatasetContentRepository.create(options.database),
      storage: new WorkerDatasetStorageResolver(options.storage),
    }),
  );
}

/** The object storage a dataset's chunked content is read and written through. */
export type WorkerDatasetObjectStorage = {
  runtime: StoredObjectStorageRuntimeAdapter;
  aws: AwsClientProcessRuntime;
  projects: WorkerProjectS3SourcePort;
  globalS3?: WorkerProjectS3Target;
  /** The `AZURE_BLOB_*` block this process read, for an Azure-routed project. */
  azureConfig: WorkerStorageConfig["azure"];
};

/**
 * Dataset's own service, composed for the ONE write a background process
 * makes: an automation appending a matched trace's mapped rows.
 */
export function createWorkerDatasetWrites(options: {
  database: PrismaClient;
  storage: WorkerDatasetObjectStorage;
}): DatasetService {
  return PostgresDatasetAdapter.create({
    database: options.database,
    storageResolver: new WorkerDatasetStorageResolver(options.storage),
  }).build();
}

class WorkerDatasetNormalizationAdapter extends DatasetNormalizationWorkerPort {
  constructor(private readonly normalization: DatasetNormalizationService) {
    super();
  }

  process(payload: DatasetNormalizePayload): Promise<void> {
    return this.normalization.process(payload);
  }

  connect(sender: DatasetNormalizationSender): void {
    this.normalization.connect(sender);
  }
}

/**
 * One project's dataset backend, resolved through the SAME destination
 * policy the rest of this process's object storage uses — so dataset
 * chunks, the trace spool, and every other stored object agree on account.
 */
export class WorkerDatasetStorageResolver extends DatasetStorageResolver {
  private readonly s3: S3DatasetStorageAdapter;
  /** Built once, on first use — matching the general registry's Azure laziness. */
  private azure: AzureDatasetStorageAdapter | undefined;

  constructor(private readonly storage: WorkerDatasetObjectStorage) {
    super();
    this.s3 = S3DatasetStorageAdapter.create(
      new WorkerDatasetS3ClientResolver(storage.aws, storage.projects, storage.globalS3),
    );
  }

  async forProject(projectId: string): Promise<DatasetStorage> {
    const destination = await this.storage.runtime
      .forProject(projectId, this.storage.aws)
      .resolveDestination();

    if (destination.kind === "s3") return this.s3;
    if (destination.kind === "azure") {
      this.azure ??= AzureDatasetStorageAdapter.create(
        new WorkerDatasetAzureConfigResolver(this.storage.azureConfig),
      );
      return this.azure;
    }
    return LocalDatasetStorageAdapter.create(destination.root);
  }
}

/**
 * This deployment's single Azure Blob account, for every project — the same
 * one-account model `WorkerAzureStorageAdapter` uses for the general path.
 * `projectId` is unread: this process composes no per-project Azure routing.
 */
class WorkerDatasetAzureConfigResolver extends DatasetAzureConfigResolver {
  constructor(private readonly azure: WorkerStorageConfig["azure"]) {
    super();
  }

  async resolve(_projectId: string): Promise<DatasetAzureConfig> {
    const driver = createWorkerAzureBlobDriver(this.azure);
    if (!driver || !this.azure.accountName || !this.azure.container) {
      throw new Error(
        "Azure object storage requires AZURE_BLOB_ACCOUNT_NAME and AZURE_BLOB_CONTAINER",
      );
    }
    return { driver, accountName: this.azure.accountName, container: this.azure.container };
  }
}

/**
 * An S3 client for one project's dataset objects. THE LEASE IS A NO-OP
 * RELEASE: one normalize job per dataset, so a fresh client per job removes
 * the lifecycle the application's shared manager needs.
 */
class WorkerDatasetS3ClientResolver extends DatasetS3ClientResolver {
  constructor(
    private readonly aws: AwsClientProcessRuntime,
    private readonly projects: WorkerProjectS3SourcePort,
    private readonly globalS3: WorkerProjectS3Target | undefined,
  ) {
    super();
  }

  async acquire(projectId: string): Promise<DatasetS3ClientLease> {
    const target = (await this.projects.tryGet(projectId)) ?? this.globalS3;
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

    return {
      s3Client,
      s3Bucket: target.bucket,
      release: () => s3Client.destroy(),
    };
  }
}
