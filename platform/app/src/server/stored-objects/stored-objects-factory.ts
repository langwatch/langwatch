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
import {
  AzureBackendMisconfiguredError,
  resolveAzureCredentials,
} from "./azure-credentials";
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
  try {
    // purpose: "read" — registration is deliberately NOT gated on the write
    // toggle. An operator migrating OFF Azure flips STORED_OBJECTS_BACKEND
    // back to s3 and keeps the AZURE_BLOB_* values so already-written objects
    // stay readable; gating here would strand every historical
    // azure-blob:// URI behind "unregistered scheme". A driver being
    // available to READ is not symmetric with Azure being chosen for WRITES.
    return new AzureBlobDriver(resolveAzureCredentials({ purpose: "read" }));
  } catch (error: unknown) {
    // Only a KNOWN misconfiguration declines quietly: the destination
    // resolver raises the same error at write time with the same actionable
    // message, so failing here too would crash every request that never
    // touches storage. Anything else is a bug in our own code, and a bare
    // catch would bury it as "Azure just isn't configured" forever.
    //
    // That reasoning only covers WRITES, and only where Azure is not the
    // selected backend. When STORED_OBJECTS_BACKEND=azure the operator has
    // asked for Azure explicitly, and swallowing here registers nothing, so
    // every READ surfaces as `Storage scheme "azure-blob" is not configured
    // in this deployment` — a message that flatly contradicts their config and
    // buries the webhook/label/annotation guidance the original error carries.
    // Let it through there; keep the quiet path for the migration case.
    if (
      error instanceof AzureBackendMisconfiguredError &&
      env.STORED_OBJECTS_BACKEND !== "azure"
    ) {
      return undefined;
    }
    throw error;
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
 * resolve at call time. Azure construction is deferred until an azure-blob://
 * URI is dispatched: a globally selected but incomplete Azure configuration
 * must not block a BYOC project whose active destination is S3. Shared by
 * `createStoredObjectsService` and any other byte path that needs the object
 * store (e.g. the GroupQueue s3 blob tier).
 */
export function createStorageRegistry({
  projectId,
}: {
  projectId: string;
}): StorageRegistry {
  return new StorageRegistry({
    s3: new S3Driver(projectId),
    file: new LocalFilesystemDriver(),
    "azure-blob": maybeAzureDriver,
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
