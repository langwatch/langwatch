/**
 * Production factory for StoredObjectsService.
 *
 * Wires the service to the real ClickHouse repository and the registry
 * containing S3, local-filesystem, and (optionally) Azure Blob drivers.
 * Kept in a separate module so the service itself stays free of
 * concrete driver imports (DI).
 *
 * Call once per request — construction is lightweight; drivers are stateless.
 */
import { env } from "~/env.mjs";
import { AzureBlobDriver } from "./azure-blob-driver";
import { LocalFilesystemDriver } from "./local-filesystem-driver";
import { S3Driver } from "./s3-driver";
import { StorageRegistry } from "./storage-registry";
import { StoredObjectsRepository } from "./stored-objects.repository";
import { StoredObjectsService } from "./stored-objects.service";

/**
 * Returns an `AzureBlobDriver` when both AZURE_BLOB_ACCOUNT_NAME and
 * AZURE_BLOB_ACCOUNT_KEY are set in the environment, otherwise `undefined`.
 * Deployments that don't use Azure don't need anything registered — the
 * StorageRegistry treats `azure-blob` URIs as an explicit error then.
 */
function maybeAzureDriver(): AzureBlobDriver | undefined {
  const accountName = env.AZURE_BLOB_ACCOUNT_NAME;
  const accountKey = env.AZURE_BLOB_ACCOUNT_KEY;
  if (!accountName || !accountKey) return undefined;
  return new AzureBlobDriver({
    accountName,
    accountKey,
    endpointBaseUrl: env.AZURE_BLOB_ENDPOINT,
  });
}

/**
 * Creates a `StoredObjectsService` wired to real storage and ClickHouse.
 *
 * The `S3Driver` is scoped to `projectId` so per-tenant BYOC S3 credentials
 * are resolved at call time.
 */
/**
 * Builds a `StorageRegistry` with the S3 / local-filesystem / (optional) Azure
 * drivers wired. The `S3Driver` is projectId-scoped so per-tenant BYOC creds
 * resolve at call time. Shared by `createStoredObjectsService` and any other
 * byte path that needs the object store (e.g. the GroupQueue s3 blob tier).
 */
export function createStorageRegistry({
  projectId,
}: {
  projectId: string;
}): StorageRegistry {
  return new StorageRegistry({
    s3: new S3Driver(projectId),
    file: new LocalFilesystemDriver(),
    "azure-blob": maybeAzureDriver(),
  });
}

export function createStoredObjectsService({
  projectId,
}: {
  projectId: string;
}): StoredObjectsService {
  const repository = new StoredObjectsRepository();
  return new StoredObjectsService(
    repository,
    createStorageRegistry({ projectId }),
  );
}
