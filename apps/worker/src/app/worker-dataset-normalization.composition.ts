import { S3Client } from "@aws-sdk/client-s3";
import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import {
  DatasetNormalizationWorkerPort,
  type DatasetNormalizationSender,
  type DatasetNormalizePayload,
} from "@langwatch/dataset-contract";
import {
  DatasetContentRepository,
  DatasetNormalizationService,
  DatasetS3ClientResolver,
  DatasetStorageResolver,
  LocalDatasetStorageAdapter,
  S3DatasetStorageAdapter,
  type DatasetContentDatabase,
  type DatasetS3ClientLease,
  type DatasetStorage,
} from "@langwatch/dataset-server";
import type { StoredObjectStorageRuntime } from "@langwatch/stored-object-server/storage";
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
 *                 └─ LocalDatasetStorageAdapter   the single-replica fallback
 *
 * AZURE IS A DECLARED ABSENCE, not a silent one. The Azure arm needs a blob
 * driver this process does not compose, and a resolver that quietly fell back
 * to the local filesystem on an Azure deployment would write one replica's
 * dataset chunks to a disk the next pod cannot read. So the resolver refuses
 * BY NAME for an Azure-routed project, and the composition root reports the
 * absence at boot rather than leaving it to be discovered by a customer whose
 * upload never completes.
 */
export function createWorkerDatasetNormalization(options: {
  database: DatasetContentDatabase;
  storage: {
    runtime: StoredObjectStorageRuntime;
    aws: AwsClientProcessRuntime;
    projects: WorkerProjectS3SourcePort;
    globalS3?: WorkerProjectS3Target;
  };
}): DatasetNormalizationWorkerPort {
  return new WorkerDatasetNormalizationAdapter(
    DatasetNormalizationService.create({
      datasets: DatasetContentRepository.create(options.database),
      storage: new WorkerDatasetStorageResolver(options.storage),
    }),
  );
}

/** Whether this deployment's object storage can back dataset normalization. */
export function workerDatasetStorageBackendSupported(backend: "azure" | "s3"): boolean {
  return backend !== "azure";
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
class WorkerDatasetStorageResolver extends DatasetStorageResolver {
  private readonly s3: S3DatasetStorageAdapter;

  constructor(
    private readonly storage: {
      runtime: StoredObjectStorageRuntime;
      aws: AwsClientProcessRuntime;
      projects: WorkerProjectS3SourcePort;
      globalS3?: WorkerProjectS3Target;
    },
  ) {
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
      throw new Error(
        "Dataset normalization is not composed for Azure object storage in this process",
      );
    }
    return LocalDatasetStorageAdapter.create(destination.root);
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
