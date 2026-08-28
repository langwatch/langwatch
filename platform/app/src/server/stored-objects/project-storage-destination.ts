import type { StoredObjectStorageDestination } from "@langwatch/stored-object-contract";
import {
  StoredObjectDestinationPolicy,
  StoredObjectAzureDestinationPort,
  StoredObjectProjectS3ConfigPort,
  type StoredObjectStorageSelection,
} from "@langwatch/stored-object-server/storage";
import { env } from "~/env.mjs";
import { getS3ConfigForProject, type DataplaneS3Config } from "~/server/dataplane-s3";
import { resolveAzureCredentials } from "./azure-credentials";

export type ProjectStorageDestination = StoredObjectStorageDestination;

const DEFAULT_LOCAL_FS_ROOT = "/var/lib/langwatch/objects";

class AppProjectS3Config extends StoredObjectProjectS3ConfigPort {
  constructor(
    private readonly resolved: { privateS3Config: DataplaneS3Config | null } | undefined,
  ) {
    super();
  }

  async tryGet(projectId: string): Promise<Readonly<{ bucket: string }> | null> {
    const config =
      this.resolved === undefined
        ? await getS3ConfigForProject(projectId)
        : this.resolved.privateS3Config;
    return config?.bucket ? { bucket: config.bucket } : null;
  }
}

class AppAzureDestination extends StoredObjectAzureDestinationPort {
  resolve(): Readonly<{ accountName: string; container: string }> {
    const credentials = resolveAzureCredentials({ purpose: "write" });
    const container = env.AZURE_BLOB_CONTAINER?.trim();
    if (!container) {
      throw new Error("Azure storage destination is missing its validated container");
    }
    return { accountName: credentials.accountName, container };
  }
}

/**
 * Resolves BYOC first, then an explicitly selected Azure backend, global S3,
 * and finally the documented single-replica local filesystem fallback.
 */
export async function resolveProjectStorageDestination(
  projectId: string,
  resolved?: { privateS3Config: DataplaneS3Config | null },
): Promise<ProjectStorageDestination> {
  const selection: StoredObjectStorageSelection = {
    backend: env.STORED_OBJECTS_BACKEND === "azure" ? "azure" : "s3",
    globalS3Bucket: env.S3_BUCKET_NAME,
    localFilesystemRoot: env.LANGWATCH_LOCAL_STORAGE_PATH ?? DEFAULT_LOCAL_FS_ROOT,
    ...(env.STORED_OBJECTS_BACKEND === "azure" ? { azure: new AppAzureDestination() } : {}),
  };
  return StoredObjectDestinationPolicy.create({
    selection,
    projects: new AppProjectS3Config(resolved),
  }).resolve(projectId);
}
