import { S3Client } from "@aws-sdk/client-s3";
import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import {
  type DatasetApi,
  DatasetNormalizationWorker,
  type DatasetNormalizationSender,
  type DatasetNormalizePayload,
} from "@langwatch/dataset-contract";
import { createApp, membersFrom, type ResourceOwnership } from "@langwatch/runtime-composition";
import {
  AzureDatasetStorageAdapter,
  DatasetApp,
  datasetServer,
  type DatasetAzureConfigResolver,
  DatasetNormalizationService,
  DatasetNormalizeAdapter,
  type DatasetS3ClientResolver,
  type DatasetStorageResolver,
  LocalDatasetStorageAdapter,
  S3DatasetStorageAdapter,
  type DatasetAzureConfig,
  type DatasetS3ClientLease,
  type DatasetStorage,
} from "@langwatch/dataset-server";
import {
  PrismaDatasetContentRepository,
  type DatasetContentDatabase,
} from "@langwatch/dataset-server/composition/dataset-content";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { StoredObjectStorageRuntimeAdapter } from "@langwatch/stored-object-server";
import { createWorkerAzureBlobDriver } from "./worker-object-storage.composition.ts";
import type { WorkerStorageConfig } from "../platform/config/worker.config.ts";
import type {
  WorkerProjectS3Source,
  WorkerProjectS3Target,
} from "../platform/infrastructure/worker-stored-object-storage.adapter.ts";
import { createAbsentRequestBound } from "@langwatch/entitlement-server";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";

/**
 * `job:datasetNormalize`, composed in this process. Azure reuses
 * `createWorkerAzureBlobDriver` rather than the general registry's factory,
 * since the finalize step needs `head()`.
 */
export function createWorkerDatasetNormalization(options: {
  database: DatasetContentDatabase;
  storage: WorkerDatasetObjectStorage;
}): DatasetNormalizationWorker {
  const datasets = PrismaDatasetContentRepository.create(options.database);
  const storage = new WorkerDatasetStorageResolver(options.storage);

  return new WorkerDatasetNormalizationAdapter(
    DatasetNormalizationService.create({
      datasets,
      normalize: DatasetNormalizeAdapter.create({
        repository: datasets,
        getStorage: (projectId) => storage.forProject(projectId),
      }),
    }),
  );
}

/** The peer halves a bounded dataset write asks for: the tier value and the
 * project→organization directory that resolves it. Both optional: a process
 * that makes no bounded write (reads and upserts only) never reaches them. */
export type WorkerDatasetRequestBounds = {
  projects?: Pick<ProjectApi, "getOrganizationId"> | undefined;
  entitlement?: Pick<EntitlementApi, "requestBound"> | undefined;
};

/** The object storage a dataset's chunked content is read and written through. */
export type WorkerDatasetObjectStorage = {
  runtime: StoredObjectStorageRuntimeAdapter;
  aws: AwsClientProcessRuntime;
  projects: WorkerProjectS3Source;
  globalS3?: WorkerProjectS3Target;
  /** The `AZURE_BLOB_*` block this process read, for an Azure-routed project. */
  azureConfig: WorkerStorageConfig["azure"];
};

// Dataset app for background reads and writes: automation appending matched
// traces and evaluation materializing datasets
export async function createWorkerDatasetApp(options: {
  database: PrismaClient;
  /** Absent where the caller reads rows only: a chunk read then has no store. */
  storage?: WorkerDatasetObjectStorage | undefined;
  resources: ResourceOwnership;
  /**
   * The bounds the record batch writes refuse above. Absent, the batch bound
   * answers its free-tier value, and the project directory is refused by name
   * on the bounded write itself, not at boot.
   */
  requestBounds?: WorkerDatasetRequestBounds | undefined;
}): Promise<DatasetApi> {
  const runtime = await createApp({
    role: "worker",
    members: membersFrom({ prisma: options.database }),
  })
    // Named through the application's own declaration: the worker provides
    // neither, and this is the one place that says so.
    .withProvided(DatasetApp.dependencies.experiments, uncomposed("experiment directory"))
    .withProvided(DatasetApp.dependencies.permissions, uncomposed("grants service"))
    .withProvided(
      DatasetApp.dependencies.projects,
      options.requestBounds?.projects ?? uncomposed("project directory"),
    )
    .withProvided(
      DatasetApp.dependencies.entitlement,
      // Every bound answers its free-tier value; any OTHER entitlement
      // question is refused by name, exactly like the uncomposed peers.
      options.requestBounds?.entitlement ??
        Object.assign(uncomposed<EntitlementApi>("plan directory"), createAbsentRequestBound()),
    )
    .withModules([datasetServer])
    .boot();

  options.resources.own("worker dataset application", () => runtime.stop());

  return runtime.module(datasetServer).provided;
}

/** A directory this process does not compose, refused by name on every member. */
function uncomposed<T extends object>(capability: string): T {
  return new Proxy({} as T, {
    get: (_target, member) => (): never => {
      throw new Error(`The worker composed no ${capability}, so ${String(member)} cannot answer.`);
    },
  });
}

class WorkerDatasetNormalizationAdapter extends DatasetNormalizationWorker {
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
export class WorkerDatasetStorageResolver implements DatasetStorageResolver {
  private readonly s3: S3DatasetStorageAdapter;
  /** Built once, on first use — matching the general registry's Azure laziness. */
  private azure: AzureDatasetStorageAdapter | undefined;

  constructor(private readonly storage: WorkerDatasetObjectStorage) {
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
class WorkerDatasetAzureConfigResolver implements DatasetAzureConfigResolver {
  constructor(private readonly azure: WorkerStorageConfig["azure"]) {}

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
class WorkerDatasetS3ClientResolver implements DatasetS3ClientResolver {
  constructor(
    private readonly aws: AwsClientProcessRuntime,
    private readonly projects: WorkerProjectS3Source,
    private readonly globalS3: WorkerProjectS3Target | undefined,
  ) {}

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
