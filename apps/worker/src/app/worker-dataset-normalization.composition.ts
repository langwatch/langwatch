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
  DatasetContentRepository,
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
import type { StoredObjectStorageRuntime } from "@langwatch/stored-object-server/storage";
import { createWorkerAzureBlobDriver } from "./worker-object-storage.composition";
import type { WorkerStorageConfig } from "../platform/config/worker.config";
import type {
  WorkerProjectS3SourcePort,
  WorkerProjectS3Target,
} from "../platform/infrastructure/worker-stored-object-storage.adapter";

/**
 * `job:datasetNormalize`, composed in this process.
 *
 * WHAT THE JOB IS. A customer uploads a CSV or JSONL, the API writes it to a
 * STAGING object and enqueues this job; the job streams that object back,
 * parses it and writes the dataset's chunked content. Until it runs, the
 * customer's dataset is empty and the upload reads as still processing — which
 * is why registering the key without a working handler would be worse than not
 * registering it: the queue would mark each job done and the upload would never
 * finish, with nothing to retry.
 *
 * IT IS THE ONE TRACE KEY THAT IS NOT A TRACE. It rides the trace pipeline's
 * job registry for a historical reason — Trace's installer owns the queue that
 * dataset uploads were first enqueued on — and moving it is a wire-format
 * change, so it converts here rather than being tidied away.
 *
 *     DatasetNormalizationWorkerPort
 *       └─ DatasetNormalizationService       (dataset-server owns the parse)
 *            ├─ DatasetContentRepository     the chunk write, over Prisma
 *            └─ DatasetStorageResolver       one backend per project
 *                 ├─ S3DatasetStorageAdapter      BYOC first, then the shared bucket
 *                 ├─ AzureDatasetStorageAdapter   the same AZURE_BLOB_* account object storage uses
 *                 └─ LocalDatasetStorageAdapter   the single-replica fallback
 *
 * Azure reuses `createWorkerAzureBlobDriver` (worker-object-storage
 * composition) rather than the general registry's Azure factory: the driver
 * that factory returns is narrowed to `StoredObjectStorageDriver`, and the
 * dataset adapter's staged-upload finalize needs `head()`, which is
 * deliberately outside that interface. A misconfigured `azure` deployment
 * still refuses BY NAME — `resolveAzureCredentials` throws
 * `AzureBackendMisconfiguredError` naming exactly what's missing — rather than
 * falling back to a local disk the next pod cannot read.
 */
export function createWorkerDatasetNormalization(options: {
  database: DatasetContentDatabase;
  storage: WorkerDatasetObjectStorage;
}): DatasetNormalizationWorkerPort {
  return new WorkerDatasetNormalizationAdapter(
    DatasetNormalizationService.create({
      datasets: DatasetContentRepository.create(options.database),
      storage: new WorkerDatasetStorageResolver(options.storage),
    }),
  );
}

/** The object storage a dataset's chunked content is read and written through. */
export type WorkerDatasetObjectStorage = {
  runtime: StoredObjectStorageRuntime;
  aws: AwsClientProcessRuntime;
  projects: WorkerProjectS3SourcePort;
  globalS3?: WorkerProjectS3Target;
  /** The `AZURE_BLOB_*` block this process read, for an Azure-routed project. */
  azureConfig: WorkerStorageConfig["azure"];
};

/**
 * Dataset's own service, composed for the ONE write a background process makes:
 * an automation appending a matched trace's mapped rows.
 *
 * It is composed with the SAME storage resolver the normalize job above uses,
 * and that is the whole reason it is here rather than beside the automation
 * graph. A dataset whose `contentLayout` is `s3_jsonl` keeps its rows in
 * chunked objects, and `batchCreateRecords` only takes that branch when the
 * service was given a content port — so a Postgres-only composition would
 * silently write the rows of an object-backed dataset into a table nothing
 * reads. One resolver means the append lands where the upload put the rest.
 *
 * The typed client rather than the structural database: the adapter narrows
 * four Prisma delegates for itself, and this process's one client satisfies
 * every one of them without a cast at the seam.
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
 * One project's dataset backend, resolved through the SAME destination policy
 * the rest of this process's object storage uses.
 *
 * Sharing the policy is the point: dataset chunks, the trace spool and every
 * other stored object for one project have to agree about which account they
 * live in. A second policy over the same configuration would agree today and
 * drift the first time either side gained a rule.
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
 * An S3 client for one project's dataset objects.
 *
 * THE LEASE IS A NO-OP RELEASE and the client is per operation, which is the
 * deliberate difference from the application's manager. That manager keeps one
 * client per project alive behind a fingerprint and reference-counts leases so
 * a target change is safe mid-operation; it earns that on a request path
 * serving many concurrent readers. This runs one normalize job per dataset,
 * serialized by the queue's group key, so a client per job costs a handshake
 * and removes the whole lifecycle — including the failure mode where a
 * superseded client is destroyed under an in-flight read.
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
