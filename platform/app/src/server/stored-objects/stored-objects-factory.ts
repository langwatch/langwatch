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
import { resolveAzureCredentials } from "./azure-credentials";
import { LocalFilesystemDriver } from "./local-filesystem-driver";
import { S3Driver } from "./s3-driver";
import { StorageRegistry } from "./storage-registry";
import { StoredObjectsRepository } from "./stored-objects.repository";
import { StoredObjectsService } from "./stored-objects.service";

/**
 * Returns an `AzureBlobDriver` built from `resolveAzureCredentials()`
 * whenever Azure is usable in ANY auth mode, otherwise `undefined`.
 *
 * Deployments that don't use Azure at all (no STORED_OBJECTS_BACKEND=azure,
 * no AZURE_BLOB_AUTH_MODE) don't need anything registered — the
 * StorageRegistry treats `azure-blob` URIs as an explicit error then, and
 * `resolveAzureCredentials()` itself throws in that case (dead-config /
 * default-sharedKey-with-nothing-set), which this function swallows into
 * `undefined` rather than crashing app boot for non-Azure installs.
 *
 * MUST agree with `resolveProjectStorageDestination`'s azure branch: both
 * call the same `resolveAzureCredentials()`, so there is no configuration
 * where writes resolve to azure while this driver is unregistered — the
 * write-outage bug the previous `accountName && accountKey` check allowed
 * for token-based modes (issue #6087).
 */
export function maybeAzureDriver(): AzureBlobDriver | undefined {
  if (env.STORED_OBJECTS_BACKEND !== "azure") return undefined;
  try {
    return new AzureBlobDriver(resolveAzureCredentials());
  } catch {
    // Misconfigured Azure (missing var, contradictory mode, etc.) — the
    // destination resolver raises the SAME error at write time with the
    // same actionable message; registration here silently declines rather
    // than crashing every request that never touches storage.
    return undefined;
  }
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
